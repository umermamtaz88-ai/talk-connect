"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Sparkles, UsersRound, MessageSquare } from "lucide-react";
import { useAppStore } from "@/lib/stores/app";
import { useAuthStore } from "@/lib/stores/auth";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenChat: (id: string) => void;
  onOpenAi: () => void;
  onNewGroup: () => void;
};

export function CommandPalette({
  open,
  onClose,
  onOpenChat,
  onOpenAi,
  onNewGroup,
}: Props) {
  const chats = useAppStore((s) => s.chats);
  const me = useAuthStore((s) => s.user);
  const motionSafe = useMotionSafe();
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) onClose();
        else {
          /* parent toggles via same shortcut */
        }
      }
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const lower = q.trim().toLowerCase();
    const list = chats
      .map((c) => ({
        id: c.id,
        label:
          c.name ??
          c.peer?.display_name ??
          (c.is_notes_to_self ? "Notes to Self" : "Chat"),
        sub: c.peer?.username ? `@${c.peer.username}` : c.is_group ? "Group" : "",
      }))
      .filter(
        (c) =>
          !lower ||
          c.label.toLowerCase().includes(lower) ||
          c.sub.toLowerCase().includes(lower),
      )
      .slice(0, 8);
    return list;
  }, [chats, q]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-label="Command palette"
            initial={motionSafe.sheet.initial}
            animate={motionSafe.sheet.animate}
            exit={motionSafe.sheet.exit}
            transition={motionSafe.sheet.transition}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Search size={16} className="text-text-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search chats, jump, or run a command…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-text-muted"
              />
              <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                esc
              </kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">
                Actions
              </p>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-hover"
                onClick={() => {
                  onOpenAi();
                  onClose();
                }}
              >
                <Sparkles size={16} className="text-brand-secondary" />
                Open TALK-CONNECT AI
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-hover"
                onClick={() => {
                  onNewGroup();
                  onClose();
                }}
              >
                <UsersRound size={16} className="text-brand-secondary" />
                New group
              </button>
              {results.length > 0 && (
                <>
                  <p className="mt-2 px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">
                    Chats
                  </p>
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-hover"
                      onClick={() => {
                        onOpenChat(r.id);
                        onClose();
                      }}
                    >
                      <MessageSquare size={16} className="text-text-muted" />
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {r.sub && (
                        <span className="truncate text-xs text-text-muted">
                          {r.sub}
                        </span>
                      )}
                    </button>
                  ))}
                </>
              )}
              {!results.length && q.trim() && (
                <p className="px-3 py-6 text-center text-xs text-text-muted">
                  No chats match “{q}”
                  {me ? "" : ""}
                </p>
              )}
            </div>
            <div className="border-t border-border px-4 py-2 text-[10px] text-text-muted">
              <span className={cn("font-mono")}>⌘K</span> /{" "}
              <span className="font-mono">Ctrl+K</span> ·{" "}
              <motion.span layout transition={transitions.fast}>
                Linear-style jump
              </motion.span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
