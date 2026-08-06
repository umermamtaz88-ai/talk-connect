"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AuroraButton } from "@/components/ui/AuroraButton";
import { GhostPillButton } from "@/components/ui/GhostPillButton";
import { friendsApi } from "@/lib/api";
import { useMotionSafe } from "@/hooks/useMotionSafe";

const REASONS: { id: string; label: string }[] = [
  { id: "spam", label: "Spam" },
  { id: "harassment", label: "Harassment" },
  { id: "inappropriate_content", label: "Inappropriate content" },
  { id: "impersonation", label: "Impersonation" },
  { id: "other", label: "Other" },
];

export function BlockReportSheet({
  open,
  userId,
  displayName,
  onClose,
  onDone,
}: {
  open: boolean;
  userId: string;
  displayName?: string;
  onClose: () => void;
  onDone?: (opts: { blocked: boolean }) => void;
}) {
  const motionSafe = useMotionSafe();
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"menu" | "report">("menu");

  async function submitReport() {
    setLoading(true);
    setError(null);
    try {
      await friendsApi.report(userId, {
        reason,
        details: details.trim() || undefined,
        alsoBlock,
      });
      onDone?.({ blocked: alsoBlock });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit report");
    } finally {
      setLoading(false);
    }
  }

  async function justBlock() {
    setLoading(true);
    setError(null);
    try {
      await friendsApi.block(userId);
      onDone?.({ blocked: true });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not block");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={motionSafe.sheet.initial}
            animate={motionSafe.sheet.animate}
            exit={motionSafe.sheet.exit}
            transition={motionSafe.sheet.transition}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-border bg-surface-elevated p-5 shadow-2xl md:inset-x-auto md:right-6 md:bottom-6 md:w-[380px] md:rounded-2xl"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong md:hidden" />
            {mode === "menu" ? (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">
                  {displayName ?? "This person"}
                </h3>
                <p className="text-sm text-text-secondary">
                  Choose an action. Reporting helps keep TALK-CONNECT safe.
                </p>
                {error && (
                  <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                )}
                <AuroraButton
                  className="w-full"
                  loading={loading}
                  onClick={() => setMode("report")}
                >
                  Report…
                </AuroraButton>
                <GhostPillButton
                  className="w-full"
                  danger
                  onClick={() => void justBlock()}
                >
                  Block
                </GhostPillButton>
                <GhostPillButton className="w-full" onClick={onClose}>
                  Cancel
                </GhostPillButton>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Report</h3>
                <div className="space-y-1">
                  {REASONS.map((r) => (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover"
                    >
                      <input
                        type="radio"
                        name="reason"
                        checked={reason === r.id}
                        onChange={() => setReason(r.id)}
                      />
                      <span className="text-sm">{r.label}</span>
                    </label>
                  ))}
                </div>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Optional details"
                  rows={3}
                  className="w-full rounded-xl border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-primary"
                />
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={alsoBlock}
                    onChange={(e) => setAlsoBlock(e.target.checked)}
                  />
                  Also block this person
                </label>
                {error && (
                  <p className="text-sm text-danger">{error}</p>
                )}
                <div className="flex gap-2">
                  <GhostPillButton
                    className="flex-1"
                    onClick={() => setMode("menu")}
                  >
                    Back
                  </GhostPillButton>
                  <AuroraButton
                    className="flex-1"
                    loading={loading}
                    onClick={() => void submitReport()}
                  >
                    Submit
                  </AuroraButton>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
