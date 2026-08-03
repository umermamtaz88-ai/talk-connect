"use client";

import { motion } from "framer-motion";
import { Pin } from "lucide-react";
import { Avatar, AvatarRing, type RingState } from "@/components/ui/Avatar";
import { cn, formatRelativeTime } from "@/lib/utils";
import { transitions } from "@/lib/motion";
import type { Chat, PresenceState } from "@/lib/types";
import { useAppStore } from "@/lib/stores/app";
import { useAuthStore } from "@/lib/stores/auth";

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
  const title = chatTitle(chat, me?.id);
  const ring = ringFor(chat, presence, focusMap, statusFeed, me?.id);
  const peer = chat.peer;
  const unread = chat.unread_count ?? 0;
  const pinned = chat.pinned;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      className={cn(
        "soft-depth flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-opacity",
        active
          ? "bg-brand-primary/15"
          : pinned
            ? "bg-brand-primary/[0.04] hover:bg-surface-hover"
            : "hover:bg-surface-hover",
      )}
    >
      <AvatarRing state={ring}>
        <Avatar
          name={title}
          url={chat.avatar_url ?? peer?.avatar_url}
          iconId={peer?.avatar_icon_id}
          size={48}
        />
      </AvatarRing>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {pinned && <Pin size={12} className="text-brand-secondary" />}
          <span className="truncate text-sm font-medium text-text-primary">
            {title}
          </span>
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
  );
}
