"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { ThreadSkeleton } from "@/components/chat/ThreadSkeleton";

const AiAssistantThread = dynamic(
  () =>
    import("@/components/chat/AiAssistantThread").then(
      (m) => m.AiAssistantThread,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full flex-col">
        <div className="h-14 border-b border-border" />
        <ThreadSkeleton />
      </div>
    ),
  },
);

/** Intercom-style persistent AI entry — overlay, never steals your place in chat. */
export function AiLauncher({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const motionSafe = useMotionSafe();

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            aria-label="Open TALK-CONNECT AI"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={motionSafe.spring}
            whileTap={motionSafe.press}
            onClick={onOpen}
            className="fixed right-4 bottom-20 z-40 md:bottom-6 md:right-6"
          >
            <span className="relative flex h-14 w-14 items-center justify-center">
              <span
                aria-hidden
                className="aurora-ring absolute inset-0 rounded-full opacity-90"
              />
              <span className="relative flex h-[50px] w-[50px] items-center justify-center rounded-full bg-surface-elevated shadow-[0_8px_24px_-8px_rgba(110,86,207,0.55)]">
                <Sparkles size={22} className="text-brand-secondary" strokeWidth={2} />
              </span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 p-0 backdrop-blur-[2px] sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <motion.div
              role="dialog"
              aria-label="TALK-CONNECT AI"
              initial={
                motionSafe.reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: 40, scale: 0.98 }
              }
              animate={
                motionSafe.reduce
                  ? { opacity: 1 }
                  : { opacity: 1, y: 0, scale: 1 }
              }
              exit={
                motionSafe.reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: 24, scale: 0.98 }
              }
              transition={motionSafe.sheet.transition}
              className="flex h-[min(92vh,720px)] w-full flex-col overflow-hidden border border-border bg-canvas shadow-2xl sm:max-w-md sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="text-xs text-text-muted">
                  Stays on top · your chat stays put
                </p>
                <button
                  type="button"
                  aria-label="Close AI"
                  className="rounded-full p-2 text-text-secondary hover:bg-surface-hover"
                  onClick={onClose}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <AiAssistantThread onBack={onClose} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
