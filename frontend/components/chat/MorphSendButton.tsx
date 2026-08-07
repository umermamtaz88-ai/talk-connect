"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Mic, Send } from "lucide-react";
import { transitions } from "@/lib/motion";
import { useMotionSafe } from "@/hooks/useMotionSafe";

export type ComposerState = "idle" | "typing" | "sending";

export function MorphSendButton({
  state,
  onSend,
  onHoldToRecord,
}: {
  state: ComposerState;
  onSend: () => void;
  onHoldToRecord?: () => void;
}) {
  const { reduce } = useMotionSafe();

  return (
    <button
      type="button"
      onClick={state === "typing" ? onSend : undefined}
      onPointerDown={state === "idle" ? onHoldToRecord : undefined}
      className="relative grid h-11 w-11 place-items-center rounded-full bg-brand-primary"
      aria-label={
        state === "idle"
          ? "Hold to record"
          : state === "typing"
            ? "Send message"
            : "Sending"
      }
    >
      <AnimatePresence mode="wait">
        {state === "idle" && (
          <motion.div
            key="mic"
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -45 }
            }
            animate={
              reduce ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }
            }
            exit={
              reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }
            }
            transition={transitions.snappy}
          >
            <Mic size={18} className="text-white" />
          </motion.div>
        )}
        {state === "typing" && (
          <motion.div
            key="send"
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: 45 }
            }
            animate={
              reduce ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }
            }
            exit={
              reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }
            }
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
