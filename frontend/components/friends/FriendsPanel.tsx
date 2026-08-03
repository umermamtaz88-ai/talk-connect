"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Virtuoso } from "react-virtuoso";
import { MessagesSquare, UsersRound } from "lucide-react";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { Avatar } from "@/components/ui/Avatar";
import { InputField } from "@/components/ui/primitives";
import { CreateGroupSheet } from "./CreateGroupSheet";
import { chatsApi, friendsApi, usersApi } from "@/lib/api";
import type { FriendRequest, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { transitions } from "@/lib/motion";

type Tab = "friends" | "requests" | "find";

export function FriendsPanel({
  onOpenChat,
}: {
  onOpenChat?: (chatId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("friends");
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<"group" | "community" | null>(
    null,
  );
  const [addingId, setAddingId] = useState<string | null>(null);
  const [messagingId, setMessagingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [findError, setFindError] = useState<string | null>(null);
  const [friendsError, setFriendsError] = useState<string | null>(null);

  async function openDirect(userId: string) {
    setFriendsError(null);
    setFindError(null);
    setMessagingId(userId);
    try {
      const chat = await chatsApi.direct(userId);
      onOpenChat?.(chat.id);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not open chat";
      setFriendsError(msg);
      setFindError(msg);
    } finally {
      setMessagingId(null);
    }
  }

  async function refresh() {
    const [f, r, outgoing] = await Promise.all([
      friendsApi.list(),
      friendsApi.requests("incoming"),
      friendsApi.requests("outgoing").catch(() => [] as FriendRequest[]),
    ]);
    setFriends(f);
    setRequests(r);
    setSentIds(new Set(outgoing.map((o) => o.to_user_id)));
  }

  useEffect(() => {
    void refresh().catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== "find" || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void usersApi.search(query).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "friends", label: "Friends" },
    { id: "requests", label: "Requests" },
    { id: "find", label: "Find People" },
  ];

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="border-b border-border px-4 pt-5 pb-3">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
          Friends
        </h2>
        <div className="mt-3 flex gap-2">
          <GhostPillButton
            className="flex flex-1 items-center !justify-center gap-1.5 !py-2 text-xs"
            onClick={() => setCreateKind("group")}
          >
            <MessagesSquare size={14} />
            New group
          </GhostPillButton>
          <GhostPillButton
            className="flex flex-1 items-center !justify-center gap-1.5 !py-2 text-xs"
            onClick={() => setCreateKind("community")}
          >
            <UsersRound size={14} />
            Community
          </GhostPillButton>
        </div>
        <div className="relative mt-4 flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "relative flex-1 rounded-lg px-2 py-2 text-sm transition",
                tab === t.id ? "text-text-primary" : "text-text-muted",
              )}
            >
              {t.label}
              {tab === t.id && (
                <motion.span
                  layoutId="friends-tab"
                  className="absolute inset-x-2 -bottom-1 h-0.5 rounded-full bg-brand-primary"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <AnimatePresence mode="wait">
          {tab === "friends" && (
            <motion.div
              key="friends"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={transitions.fast}
              className="space-y-1"
            >
              {friendsError && (
                <p className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {friendsError}
                </p>
              )}
              {friends.length === 0 ? (
                <p className="py-10 text-center text-sm text-text-muted">
                  No friends yet. Find people to connect, then start a group.
                </p>
              ) : (
                <div className="h-[min(60vh,480px)]">
                  <Virtuoso
                    data={friends}
                    increaseViewportBy={200}
                    itemContent={(_i, u) => (
                      <button
                        type="button"
                        disabled={messagingId === u.id}
                        className="mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 hover:bg-surface-hover disabled:opacity-60"
                        onClick={() => void openDirect(u.id)}
                      >
                        <Avatar
                          name={u.display_name}
                          url={u.avatar_url}
                          iconId={u.avatar_icon_id}
                          size={44}
                        />
                        <div className="min-w-0 text-left">
                          <p className="truncate text-sm font-medium">
                            {u.display_name}
                          </p>
                          <p className="text-xs text-text-muted">
                            @{u.username}
                            {u.online || u.presence_state === "online"
                              ? " · online"
                              : ""}
                            {messagingId === u.id ? " · opening…" : ""}
                          </p>
                        </div>
                      </button>
                    )}
                  />
                </div>
              )}
            </motion.div>
          )}

          {tab === "requests" && (
            <motion.div
              key="requests"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {requests.length === 0 ? (
                <p className="py-10 text-center text-sm text-text-muted">
                  No pending requests.
                </p>
              ) : (
                requests.map((r) => {
                  const u = r.from_user;
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-2xl border border-border px-3 py-3"
                    >
                      <div className="relative">
                        <Avatar
                          name={u?.display_name}
                          url={u?.avatar_url}
                          size={44}
                        />
                        <AnimatePresence>
                          {mergingId === r.id && (
                            <motion.div
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1.4, opacity: 0 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 rounded-full ring-2 ring-success"
                            />
                          )}
                        </AnimatePresence>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {u?.display_name ?? "User"}
                        </p>
                        <p className="text-xs text-text-muted">
                          wants to connect
                        </p>
                      </div>
                      <GhostPillButton
                        danger
                        className="!px-3 !py-1.5 text-xs"
                        onClick={async () => {
                          await friendsApi.decline(r.id);
                          await refresh();
                        }}
                      >
                        Decline
                      </GhostPillButton>
                      <AuroraButton
                        className="!px-3 !py-1.5 text-xs"
                        onClick={async () => {
                          setMergingId(r.id);
                          await friendsApi.accept(r.id);
                          setTimeout(async () => {
                            setMergingId(null);
                            await refresh();
                          }, 600);
                        }}
                      >
                        Accept
                      </AuroraButton>
                    </div>
                  );
                })
              )}
            </motion.div>
          )}

          {tab === "find" && (
            <motion.div
              key="find"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <InputField
                label="Search people"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="username or name"
              />
              {findError && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {findError}
                </p>
              )}
              {results.map((u) => {
                const isFriend = Boolean(u.is_friend);
                const sent = sentIds.has(u.id);
                const busy = addingId === u.id;
                return (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 rounded-2xl px-2 py-2"
                  >
                    <Avatar name={u.display_name} url={u.avatar_url} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{u.display_name}</p>
                      <p className="text-xs text-text-muted">@{u.username}</p>
                    </div>
                    {isFriend ? (
                      <GhostPillButton
                        className="!px-3 !py-1.5 text-xs"
                        disabled={messagingId === u.id}
                        onClick={() => void openDirect(u.id)}
                      >
                        {messagingId === u.id ? "Opening…" : "Message"}
                      </GhostPillButton>
                    ) : (
                      <AuroraButton
                        className="!px-3 !py-1.5 text-xs"
                        loading={busy}
                        disabled={sent || busy}
                        onClick={async () => {
                          setFindError(null);
                          setAddingId(u.id);
                          try {
                            await friendsApi.send(u.id);
                            setSentIds((prev) => new Set(prev).add(u.id));
                            await refresh();
                            if (query.trim().length >= 2) {
                              const next = await usersApi.search(query);
                              setResults(next);
                            }
                          } catch (err) {
                            setFindError(
                              err instanceof Error
                                ? err.message
                                : "Could not send request",
                            );
                          } finally {
                            setAddingId(null);
                          }
                        }}
                      >
                        {sent ? "Sent" : "Add"}
                      </AuroraButton>
                    )}
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <CreateGroupSheet
        open={createKind !== null}
        kind={createKind ?? "group"}
        onClose={() => setCreateKind(null)}
        onCreated={(id) => onOpenChat?.(id)}
      />
    </div>
  );
}
