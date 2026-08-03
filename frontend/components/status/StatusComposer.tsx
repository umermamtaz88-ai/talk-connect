"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Image as ImageIcon, Type, Video, X } from "lucide-react";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { mediaApi, statusApi } from "@/lib/api";
import { motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

const BACKGROUNDS = ["aurora", "sunset", "ocean", "midnight", "forest"];

type Mode = "text" | "image" | "video";

export function StatusComposer({
  open,
  onClose,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [mode, setMode] = useState<Mode>("text");
  const [caption, setCaption] = useState("");
  const [bg, setBg] = useState("aurora");
  const [privacy, setPrivacy] = useState("friends");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  function reset() {
    setMode("text");
    setCaption("");
    setBg("aurora");
    setPrivacy("friends");
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setError(null);
  }

  function pickFile(next: File | null, nextMode: Mode) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    setMode(nextMode);
  }

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      if (mode === "text") {
        if (!caption.trim()) {
          setError("Write something for your status");
          return;
        }
        await statusApi.create({
          type: "text",
          caption: caption.trim(),
          background_style: bg,
          privacy,
        });
      } else {
        if (!file) {
          setError(mode === "image" ? "Pick a photo" : "Pick a video");
          return;
        }
        const uploaded = await mediaApi.upload(file, "status");
        await statusApi.create({
          type: mode,
          caption: caption.trim() || null,
          storage_key: uploaded.storage_key,
          privacy,
        });
      }
      reset();
      onPosted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post status");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: motionTokens.duration.base }}
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface-elevated sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
                New status
              </h3>
              <button
                type="button"
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="rounded-full p-2 text-text-muted hover:bg-surface-hover"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex gap-2 px-4 pt-4">
              {(
                [
                  { id: "text" as const, icon: Type, label: "Text" },
                  { id: "image" as const, icon: ImageIcon, label: "Photo" },
                  { id: "video" as const, icon: Video, label: "Video" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (m.id === "image") imageRef.current?.click();
                    else if (m.id === "video") videoRef.current?.click();
                    else {
                      pickFile(null, "text");
                      setMode("text");
                    }
                  }}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition",
                    mode === m.id
                      ? "border-brand-primary bg-brand-primary/15 text-brand-secondary"
                      : "border-border text-text-secondary hover:bg-surface-hover",
                  )}
                >
                  <m.icon size={16} />
                  {m.label}
                </button>
              ))}
            </div>

            <input
              ref={imageRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) pickFile(f, "image");
                e.target.value = "";
              }}
            />
            <input
              ref={videoRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) pickFile(f, "video");
                e.target.value = "";
              }}
            />

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {mode === "text" ? (
                <div
                  className={cn(
                    "flex min-h-[220px] items-center justify-center rounded-3xl p-6 text-center",
                    bg === "aurora" && "aurora-bg",
                    bg === "sunset" && "bg-gradient-to-br from-orange-500 to-rose-600",
                    bg === "ocean" && "bg-gradient-to-br from-cyan-500 to-blue-700",
                    bg === "midnight" && "bg-gradient-to-br from-indigo-900 to-slate-950",
                    bg === "forest" && "bg-gradient-to-br from-emerald-600 to-teal-900",
                  )}
                >
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value.slice(0, 300))}
                    placeholder="Share something…"
                    className="w-full resize-none bg-transparent text-center text-2xl font-semibold text-white outline-none placeholder:text-white/50"
                    rows={4}
                  />
                </div>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-border bg-black">
                  {preview ? (
                    mode === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview}
                        alt="Status preview"
                        className="max-h-[320px] w-full object-contain"
                      />
                    ) : (
                      <video
                        src={preview}
                        controls
                        className="max-h-[320px] w-full"
                      />
                    )
                  ) : (
                    <button
                      type="button"
                      className="flex h-52 w-full flex-col items-center justify-center gap-2 text-text-muted"
                      onClick={() =>
                        mode === "image"
                          ? imageRef.current?.click()
                          : videoRef.current?.click()
                      }
                    >
                      {mode === "image" ? <ImageIcon size={28} /> : <Video size={28} />}
                      <span className="text-sm">
                        Tap to choose a {mode === "image" ? "photo" : "video"}
                      </span>
                    </button>
                  )}
                  <input
                    value={caption}
                    onChange={(e) => setCaption(e.target.value.slice(0, 200))}
                    placeholder="Add a caption (optional)"
                    className="w-full border-t border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40"
                  />
                </div>
              )}

              {mode === "text" && (
                <div>
                  <p className="mb-2 text-xs font-medium text-text-secondary">
                    Background
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BACKGROUNDS.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBg(b)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs capitalize",
                          bg === b
                            ? "bg-brand-primary/20 text-brand-secondary"
                            : "bg-surface-hover text-text-secondary",
                        )}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-medium text-text-secondary">
                  Who can see
                </p>
                <div className="flex gap-2">
                  {[
                    { id: "friends", label: "Friends" },
                    { id: "close_friends", label: "Close friends" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPrivacy(p.id)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs",
                        privacy === p.id
                          ? "bg-brand-primary/20 text-brand-secondary"
                          : "bg-surface-hover text-text-secondary",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="flex gap-3 border-t border-border p-4">
              <GhostPillButton
                className="flex-1"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Cancel
              </GhostPillButton>
              <AuroraButton
                className="flex-1"
                loading={loading}
                onClick={() => void submit()}
              >
                Post status
              </AuroraButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
