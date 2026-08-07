"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Mic, Send, Square } from "lucide-react";
import { transitions } from "@/lib/motion";
import { useMotionSafe } from "@/hooks/useMotionSafe";

export type ComposerState = "idle" | "typing" | "sending" | "recording";

export function MorphSendButton({
  state,
  onSend,
  onMicPress,
}: {
  state: ComposerState;
  onSend: () => void;
  /** Tap mic when idle to start, tap again while recording to send. */
  onMicPress?: () => void;
}) {
  const { reduce } = useMotionSafe();

  return (
    <button
      type="button"
      onClick={() => {
        if (state === "typing") onSend();
        else if (state === "idle" || state === "recording") onMicPress?.();
      }}
      className={
        state === "recording"
          ? "relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-danger"
          : "relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-primary"
      }
      aria-label={
        state === "idle"
          ? "Record voice note"
          : state === "typing"
            ? "Send message"
            : state === "recording"
              ? "Stop and send voice note"
              : "Sending"
      }
    >
      <AnimatePresence mode="wait">
        {state === "idle" && (
          <motion.div
            key="mic"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={transitions.snappy}
          >
            <Mic size={18} className="text-white" />
          </motion.div>
        )}
        {state === "recording" && (
          <motion.div
            key="stop"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={transitions.snappy}
          >
            <Square size={16} className="fill-white text-white" />
          </motion.div>
        )}
        {state === "typing" && (
          <motion.div
            key="send"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={transitions.snappy}
          >
            <Send size={18} className="text-white" />
          </motion.div>
        )}
        {state === "sending" && (
          <motion.div
            key="spin"
            animate={reduce ? undefined : { rotate: 360 }}
            transition={
              reduce
                ? undefined
                : { repeat: Infinity, duration: 0.8, ease: "linear" }
            }
          >
            <Loader2 size={18} className="text-white" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}
