"use client";

import { useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Search, Sparkles, SquarePen, UsersRound } from "lucide-react";
import { ChatListItem } from "./ChatListItem";
import { ChatListSkeleton } from "./ThreadSkeleton";
import { StatusFeedStrip } from "@/components/status/StatusFeedStrip";
import { CreateGroupSheet } from "@/components/friends/CreateGroupSheet";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { AI_CHAT_ID } from "./AiAssistantThread";
import { useAppStore } from "@/lib/stores/app";
import type { Chat } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChatList({
  onSelect,
  onOpenAi,
  activeId,
}: {
  onSelect: (id: string) => void;
  onOpenAi?: () => void;
  activeId?: string | null;
}) {
  const chats = useAppStore((s) => s.chats);
  const loadChats = useAppStore((s) => s.loadChats);
  const prefetchMessages = useAppStore((s) => s.prefetchMessages);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [createKind, setCreateKind] = useState<"group" | "community" | null>(
    null,
  );

  useEffect(() => {
    void loadChats().finally(() => setLoading(false));
  }, [loadChats]);

  const filtered = useMemo(() => {
    const sorted = [...chats].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const at = a.last_message?.created_at ?? "";
      const bt = b.last_message?.created_at ?? "";
      return bt.localeCompare(at);
    });
    if (!q.trim()) return sorted;
    const lower = q.toLowerCase();
    return sorted.filter(
      (c) =>
        c.name?.toLowerCase().includes(lower) ||
        c.description?.toLowerCase().includes(lower) ||
        c.peer?.display_name?.toLowerCase().includes(lower) ||
        c.peer?.username?.toLowerCase().includes(lower),
    );
  }, [chats, q]);

  const showAi =
    !q.trim() ||
    "talk-connect ai".includes(q.toLowerCase()) ||
    "talk connect ai".includes(q.toLowerCase()) ||
    q.toLowerCase().includes("ai");

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface md:w-[340px] md:min-w-[320px]">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <BrandLogo variant="mark" className="h-8 w-8 md:hidden" />
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Chats
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-full p-2 text-text-secondary hover:bg-surface-hover hover:text-brand-secondary"
            aria-label="New community"
            title="New community"
            onClick={() => setCreateKind("community")}
          >
            <UsersRound size={18} />
          </button>
          <button
            type="button"
            className="rounded-full p-2 text-text-secondary hover:bg-surface-hover hover:text-brand-secondary"
            aria-label="New group"
            title="New group"
            onClick={() => setCreateKind("group")}
          >
            <SquarePen size={18} />
          </button>
        </div>
      </div>

      <StatusFeedStrip />

      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-canvas px-3 py-2">
          <Search size={16} className="text-text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats"
            className="w-full bg-transparent text-sm outline-none placeholder:text-text-muted"
          />
        </div>
      </div>

      {showAi && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => (onOpenAi ? onOpenAi() : onSelect(AI_CHAT_ID))}
            className={cn(
              "soft-depth flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition",
              "hover:bg-surface-hover",
            )}
          >
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-brand-secondary"
              style={{
                background:
                  "linear-gradient(#1a1f38, #1a1f38) padding-box, var(--aurora) border-box",
                border: "2px solid transparent",
              }}
            >
              <Sparkles size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">TALK-CONNECT AI</p>
              <p className="truncate text-xs text-text-muted">
                Opens beside your chat
              </p>
            </div>
            <span className="rounded-md border border-brand-primary/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-secondary">
              AI
            </span>
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 px-2 pb-4">
        {loading && filtered.length === 0 ? (
          <ChatListSkeleton />
        ) : filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-text-muted">
            No chats yet. Add friends or create a group.
          </p>
        ) : (
          <Virtuoso
            data={filtered}
            className="h-full"
            increaseViewportBy={200}
            itemContent={(_i, chat: Chat) => (
              <div className="pb-1">
                <ChatListItem
                  chat={chat}
                  active={chat.id === activeId}
                  onClick={() => onSelect(chat.id)}
                  onPrefetch={() => void prefetchMessages(chat.id)}
                />
              </div>
            )}
          />
        )}
      </div>

      <CreateGroupSheet
        open={createKind !== null}
        kind={createKind ?? "group"}
        onClose={() => setCreateKind(null)}
        onCreated={(id) => onSelect(id)}
      />
    </aside>
  );
}
