"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pin } from "lucide-react";
import { Avatar, AvatarRing, type RingState } from "@/components/ui/Avatar";
import { cn, formatRelativeTime } from "@/lib/utils";
import { motionTokens, transitions } from "@/lib/motion";
import type { Chat, PresenceState } from "@/lib/types";
import { useAppStore } from "@/lib/stores/app";
import { useAuthStore } from "@/lib/stores/auth";
import { useMotionSafe } from "@/hooks/useMotionSafe";

function chatTitle(chat: Chat, myId?: string): string {
  if (chat.is_notes_to_self) return "Notes to Self";
  if (chat.name) return chat.name;
  if (chat.peer) return chat.peer.display_name;
  const other = chat.members?.find((m) => m.user_id !== myId);
  return other?.user?.display_name ?? "Chat";
}

function ringFor(
  chat: Chat,
  presence: Record<string, PresenceState>,
  focusMap: Record<string, { until?: string; message?: string }>,
  statusFeed: ReturnType<typeof useAppStore.getState>["statusFeed"],
  myId?: string,
): RingState {
  if (chat.is_group || chat.is_notes_to_self) return "none";
  const peerId =
    chat.peer?.id ??
    chat.members?.find((m) => m.user_id !== myId)?.user_id;
  if (!peerId) return "none";

  const focus = focusMap[peerId];
  if (focus?.until && new Date(focus.until) > new Date()) return "focus";

  const feed = statusFeed.find((f) => f.user.id === peerId);
  if (feed?.has_unseen) return "unseen";

  const p = presence[peerId] ?? chat.peer?.presence_state;
  if (p === "online" || p === "on_call" || p === "screen_sharing")
    return "online";
  return "none";
}

/** Conversation Pulse — capped warm/cool tint from recent activity. */
function conversationPulse(chat: Chat): string | undefined {
  const ts = chat.last_message?.created_at;
  if (!ts) return undefined;
  const ageMin = (Date.now() - new Date(ts).getTime()) / 60_000;
  const unread = chat.unread_count ?? 0;
  // Active in last hour or unread → warmer coral shift, max ~6% sat
  let warmth = 0;
  if (ageMin < 60) warmth += (1 - ageMin / 60) * 0.04;
  if (unread > 0) warmth += Math.min(unread, 8) * 0.0025;
  warmth = Math.min(0.06, warmth);
  if (warmth < 0.01) return undefined;
  return `rgba(255, 107, 107, ${warmth.toFixed(3)})`;
}

export function ChatListItem({
  chat,
  active,
  onClick,
  onPrefetch,
}: {
  chat: Chat;
  active?: boolean;
  onClick: () => void;
  onPrefetch?: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const presence = useAppStore((s) => s.presence);
  const focusMap = useAppStore((s) => s.focusMap);
  const statusFeed = useAppStore((s) => s.statusFeed);
  const messages = useAppStore((s) => s.messages[chat.id]);
  const motionSafe = useMotionSafe();
  const title = chatTitle(chat, me?.id);
  const ring = ringFor(chat, presence, focusMap, statusFeed, me?.id);
  const peer = chat.peer;
  const unread = chat.unread_count ?? 0;
  const pinned = chat.pinned;
  const pulse = useMemo(() => conversationPulse(chat), [chat]);
  const [peek, setPeek] = useState(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPress() {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  }

  const peekMessages = (messages ?? []).slice(-3);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        onPointerDown={() => {
          clearPress();
          longPress.current = setTimeout(() => {
            setPeek(true);
            onPrefetch?.();
          }, 450);
        }}
        onPointerUp={clearPress}
        onPointerLeave={() => {
          clearPress();
          setPeek(false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setPeek(true);
          onPrefetch?.();
        }}
        className={cn(
          "soft-depth flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-opacity",
          active
            ? "bg-brand-primary/15"
            : pinned
              ? "bg-brand-primary/[0.04] hover:bg-surface-hover"
              : "hover:bg-surface-hover",
        )}
        style={pulse && !active ? { backgroundImage: `linear-gradient(${pulse}, ${pulse})` } : undefined}
      >
        <motion.div layoutId={motionSafe.reduce ? undefined : `chat-avatar-${chat.id}`}>
          <AvatarRing state={ring}>
            <Avatar
              name={title}
              url={chat.avatar_url ?? peer?.avatar_url}
              iconId={peer?.avatar_icon_id}
              size={48}
            />
          </AvatarRing>
        </motion.div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {pinned && <Pin size={12} className="text-brand-secondary" />}
            <motion.span
              layoutId={motionSafe.reduce ? undefined : `chat-title-${chat.id}`}
              className="truncate text-sm font-medium text-text-primary"
            >
              {title}
            </motion.span>
            {chat.is_community && (
              <span className="shrink-0 rounded-full bg-brand-primary/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-brand-secondary">
                Community
              </span>
            )}
            {chat.is_group && !chat.is_community && (
              <span className="shrink-0 rounded-full bg-surface-hover px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-text-muted">
                Group
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
              {formatRelativeTime(chat.last_message?.created_at)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="truncate text-xs text-text-secondary">
              {chat.last_message?.deleted_at
                ? "Message deleted"
                : chat.last_message?.type === "code"
                  ? `</> ${chat.last_message.code_language ?? "code"}`
                  : chat.last_message?.body ??
                    chat.description ??
                    (chat.is_group ? "Group chat" : "No messages yet")}
            </p>
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0, 1.15, 1], opacity: 1 }}
                transition={transitions.snappy}
                className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white"
              >
                {unread > 99 ? "99+" : unread}
              </motion.span>
            )}
          </div>
        </div>
      </button>

      <AnimatePresence>
        {peek && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            transition={motionTokens.sharedElement}
            className="elevation-1 absolute left-3 right-3 top-full z-30 mt-1 rounded-xl p-3 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">
              Quick Glance
            </p>
            {peekMessages.length === 0 ? (
              <p className="text-xs text-text-secondary">No cached messages yet</p>
            ) : (
              <ul className="space-y-1.5">
                {peekMessages.map((m) => (
                  <li
                    key={m.id}
                    className="truncate text-xs text-text-secondary"
                  >
                    <span className="text-text-muted">
                      {m.sender_id === me?.id ? "You" : title}:
                    </span>{" "}
                    {m.deleted_at ? "deleted" : m.body ?? m.type}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="mt-2 text-xs text-brand-secondary"
              onClick={() => {
                setPeek(false);
                onClick();
              }}
            >
              Open chat
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
