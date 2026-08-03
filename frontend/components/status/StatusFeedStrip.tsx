"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { StatusComposer } from "./StatusComposer";
import { mediaApi, statusApi } from "@/lib/api";
import { useAppStore } from "@/lib/stores/app";
import { useAuthStore } from "@/lib/stores/auth";
import { motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { StatusFeedItem, StatusPost } from "@/lib/types";

const QUICK_REACT = ["👍", "👎"];
const REACT_EMOJIS = ["❤️", "😂", "😮", "😢", "🙏", "🔥"];

export function StatusFeedStrip() {
  const feed = useAppStore((s) => s.statusFeed);
  const setStatusFeed = useAppStore((s) => s.setStatusFeed);
  const me = useAuthStore((s) => s.user);
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewer, setViewer] = useState<{
    item: StatusFeedItem;
    index: number;
  } | null>(null);

  async function refreshFeed() {
    try {
      const next = await statusApi.feed();
      setStatusFeed(next);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    // Defer status fetch so chat list can paint first (Neon is high-latency)
    const t = window.setTimeout(() => {
      void refreshFeed();
    }, 150);
    return () => window.clearTimeout(t);
  }, [setStatusFeed]);

  const myItem = feed.find((f) => f.user.id === me?.id);
  const others = feed.filter((f) => f.user.id !== me?.id);

  return (
    <>
      <div className="flex gap-3 overflow-x-auto px-3 pb-3">
        <button
          type="button"
          className="flex shrink-0 flex-col items-center gap-1"
          onClick={() => {
            if (myItem?.statuses.length) {
              setViewer({ item: myItem, index: 0 });
            } else {
              setComposerOpen(true);
            }
          }}
        >
          <div className="relative">
            <div
              className={cn(
                "rounded-full p-[2px]",
                myItem?.statuses.length
                  ? "status-ring-unseen"
                  : "border-2 border-dashed border-border",
              )}
            >
              <Avatar name={me?.display_name} url={me?.avatar_url} size={52} />
            </div>
            <span className="absolute -right-0.5 -bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-primary text-white shadow">
              <Plus size={12} />
            </span>
          </div>
          <span className="max-w-[64px] truncate text-[10px] text-text-muted">
            Your status
          </span>
        </button>

        <button
          type="button"
          className="hidden"
          aria-hidden
          onClick={() => setComposerOpen(true)}
        />

        {others.map((item) => (
          <button
            key={item.user.id}
            type="button"
            className="flex shrink-0 flex-col items-center gap-1"
            onClick={() => setViewer({ item, index: 0 })}
          >
            <div
              className={
                item.has_unseen
                  ? "status-ring-unseen"
                  : "rounded-full p-[2px] ring-2 ring-border"
              }
            >
              <Avatar
                name={item.user.display_name}
                url={item.user.avatar_url}
                iconId={item.user.avatar_icon_id}
                size={52}
              />
            </div>
            <span className="max-w-[64px] truncate text-[10px] text-text-secondary">
              {item.user.display_name}
            </span>
          </button>
        ))}
      </div>

      {/* Always-available add via long-press alternative: tap plus on your ring when you already have status */}
      {myItem?.statuses.length ? (
        <div className="-mt-2 mb-2 px-3">
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="text-xs text-brand-secondary"
          >
            + Add photo, video, or text
          </button>
        </div>
      ) : null}

      <StatusComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPosted={() => void refreshFeed()}
      />

      <AnimatePresence>
        {viewer && (
          <StatusViewer
            item={viewer.item}
            startIndex={viewer.index}
            isMine={viewer.item.user.id === me?.id}
            onClose={() => setViewer(null)}
            onAddMore={() => {
              setViewer(null);
              setComposerOpen(true);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function StatusViewer({
  item,
  startIndex,
  isMine,
  onClose,
  onAddMore,
}: {
  item: StatusFeedItem;
  startIndex: number;
  isMine?: boolean;
  onClose: () => void;
  onAddMore?: () => void;
}) {
  const statuses = item.statuses;
  const [index, setIndex] = useState(startIndex);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const current = statuses[index] as StatusPost | undefined;
  const mediaUrl = mediaApi.url(current?.storage_key);

  useEffect(() => {
    if (!current || paused) return;
    void statusApi.view(current.id).catch(() => {});
    const duration = current.type === "video" ? 12000 : 5000;
    const t = setTimeout(() => {
      if (index < statuses.length - 1) setIndex((i) => i + 1);
      else onClose();
    }, duration);
    return () => clearTimeout(t);
  }, [current, index, statuses.length, paused, onClose]);

  useEffect(() => {
    if (!current) return;
    const base: Record<string, number> = { ...(current.reaction_counts ?? {}) };
    (current.reactions ?? []).forEach((r) => {
      base[r.emoji] = (base[r.emoji] ?? 0) + 1;
    });
    setCounts(base);
  }, [current]);

  if (!current) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
    >
      <div className="flex gap-1 px-3 pt-3">
        {statuses.map((_, i) => (
          <div
            key={i}
            className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25"
          >
            <motion.div
              className="h-full w-full origin-left bg-white"
              initial={{ scaleX: i < index ? 1 : 0 }}
              animate={{
                scaleX:
                  i < index
                    ? 1
                    : i === index && !paused
                      ? 1
                      : i === index
                        ? undefined
                        : 0,
              }}
              transition={
                i === index && !paused
                  ? {
                      duration: current.type === "video" ? 12 : 5,
                      ease: "linear",
                    }
                  : { duration: motionTokens.duration.base }
              }
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar
          name={item.user.display_name}
          url={item.user.avatar_url}
          size={36}
        />
        <span className="text-sm font-medium text-white">
          {item.user.display_name}
        </span>
        {isMine && (
          <button
            type="button"
            onClick={onAddMore}
            className="rounded-full bg-white/15 px-3 py-1 text-xs text-white"
          >
            Add
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-white/80"
        >
          <X size={20} />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-2">
        {current.type === "image" && mediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl}
            alt={current.caption ?? "Status"}
            className="max-h-full max-w-full object-contain"
          />
        ) : current.type === "video" && mediaUrl ? (
          <video
            src={mediaUrl}
            autoPlay
            playsInline
            muted={false}
            controls={false}
            className="max-h-full max-w-full"
            onPlay={() => setPaused(false)}
          />
        ) : current.type === "text" ? (
          <div
            className={cn(
              "flex min-h-[40%] w-full max-w-md items-center justify-center rounded-3xl p-8 text-center text-2xl font-semibold text-white",
              !current.background_style || current.background_style === "aurora"
                ? "aurora-bg"
                : current.background_style === "sunset"
                  ? "bg-gradient-to-br from-orange-500 to-rose-600"
                  : current.background_style === "ocean"
                    ? "bg-gradient-to-br from-cyan-500 to-blue-700"
                    : current.background_style === "midnight"
                      ? "bg-gradient-to-br from-indigo-900 to-slate-950"
                      : current.background_style === "forest"
                        ? "bg-gradient-to-br from-emerald-600 to-teal-900"
                        : "aurora-bg",
            )}
          >
            {current.caption}
          </div>
        ) : (
          <p className="text-white">{current.caption ?? "Media unavailable"}</p>
        )}

        {current.caption && current.type !== "text" && (
          <p className="absolute bottom-4 left-4 right-4 rounded-2xl bg-black/45 px-4 py-2 text-center text-sm text-white">
            {current.caption}
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-1 px-4 pb-2">
        {Object.entries(counts).map(([emoji, n]) => (
          <motion.span
            key={emoji}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-full bg-white/15 px-2 py-0.5 text-xs text-white"
          >
            {emoji} {n}
          </motion.span>
        ))}
      </div>

      {!isMine && (
        <>
          <div className="flex items-center justify-center gap-3 px-3 pb-2">
            {QUICK_REACT.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl hover:bg-white/25"
                onClick={async () => {
                  await statusApi.react(current.id, emoji);
                  setCounts((c) => ({ ...c, [emoji]: (c[emoji] ?? 0) + 1 }));
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center gap-1 px-3 pb-2">
            {REACT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded-full px-2 py-1 text-xl hover:bg-white/10"
                onClick={async () => {
                  await statusApi.react(current.id, emoji);
                  setCounts((c) => ({ ...c, [emoji]: (c[emoji] ?? 0) + 1 }));
                }}
              >
                {emoji}
              </button>
            ))}
          </div>

          <form
            className="flex gap-2 px-3 pb-6"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!reply.trim()) return;
              await statusApi.reply(current.id, reply.trim());
              setReply("");
            }}
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply privately…"
              className="flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/50"
              onPointerDown={(e) => e.stopPropagation()}
            />
            <AuroraButton type="submit" className="!px-4 !py-2.5 text-sm">
              Send
            </AuroraButton>
          </form>
        </>
      )}
    </motion.div>
  );
}
