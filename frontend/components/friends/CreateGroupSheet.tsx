"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Users, X } from "lucide-react";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { Avatar } from "@/components/ui/Avatar";
import { InputField } from "@/components/ui/primitives";
import { chatsApi, friendsApi } from "@/lib/api";
import { useAppStore } from "@/lib/stores/app";
import { motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/types";

type Kind = "group" | "community";

export function CreateGroupSheet({
  open,
  kind = "group",
  onClose,
  onCreated,
}: {
  open: boolean;
  kind?: Kind;
  onClose: () => void;
  onCreated?: (chatId: string) => void;
}) {
  const upsertChat = useAppStore((s) => s.upsertChat);
  const [friends, setFriends] = useState<User[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void friendsApi
      .list()
      .then(setFriends)
      .catch(() => setFriends([]));
    setSelected(new Set());
    setName("");
    setDescription("");
    setQuery("");
    setError(null);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.display_name.toLowerCase().includes(q) ||
        f.username.toLowerCase().includes(q),
    );
  }, [friends, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (!name.trim()) {
      setError(
        kind === "community"
          ? "Give your community a name"
          : "Give your group a name",
      );
      return;
    }
    if (selected.size === 0) {
      setError("Pick at least one friend");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const chat = await chatsApi.createGroup(name.trim(), [...selected], {
        description: description.trim() || undefined,
        isCommunity: kind === "community",
      });
      upsertChat(chat);
      onCreated?.(chat.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create");
    } finally {
      setLoading(false);
    }
  }

  const title = kind === "community" ? "New community" : "New group";
  const subtitle =
    kind === "community"
      ? "Invite friends into a shared space with a topic."
      : "Chat together with friends you choose.";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: motionTokens.duration.base }}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface-elevated sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-brand-secondary" />
                <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-text-muted hover:bg-surface-hover"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto px-4 py-4">
              <p className="text-sm text-text-secondary">{subtitle}</p>
              <InputField
                label={kind === "community" ? "Community name" : "Group name"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  kind === "community" ? "Design crew" : "Weekend plans"
                }
                maxLength={120}
              />
              {kind === "community" && (
                <InputField
                  label="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this community about?"
                  maxLength={500}
                />
              )}
              <InputField
                label="Add friends"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends"
              />

              <div className="max-h-[40vh] space-y-1 overflow-y-auto rounded-2xl border border-border p-2">
                {filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-text-muted">
                    {friends.length === 0
                      ? "Add friends first, then create a group."
                      : "No matches."}
                  </p>
                ) : (
                  filtered.map((u) => {
                    const on = selected.has(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggle(u.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition",
                          on ? "bg-brand-primary/15" : "hover:bg-surface-hover",
                        )}
                      >
                        <Avatar
                          name={u.display_name}
                          url={u.avatar_url}
                          iconId={u.avatar_icon_id}
                          size={40}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {u.display_name}
                          </p>
                          <p className="text-xs text-text-muted">
                            @{u.username}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-full border",
                            on
                              ? "border-brand-primary bg-brand-primary text-white"
                              : "border-border text-transparent",
                          )}
                        >
                          <Check size={14} />
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {selected.size > 0 && (
                <p className="text-xs text-text-secondary">
                  {selected.size} friend{selected.size === 1 ? "" : "s"} selected
                </p>
              )}

              {error && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="flex gap-3 border-t border-border p-4">
              <GhostPillButton className="flex-1" onClick={onClose}>
                Cancel
              </GhostPillButton>
              <AuroraButton
                className="flex-1"
                loading={loading}
                onClick={() => void create()}
              >
                Create {kind === "community" ? "community" : "group"}
              </AuroraButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
