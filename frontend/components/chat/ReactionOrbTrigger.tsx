"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState } from "react";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { transitions } from "@/lib/motion";

const EMOJIS = ["❤️", "😂", "😮", "😢", "🙏", "🔥"];

export function ReactionOrbTrigger({
  children,
  onReact,
}: {
  children: React.ReactNode;
  onReact: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionSafe = useMotionSafe();

  return (
    <div className="relative">
      <motion.div
        onPointerDown={() => {
          timer.current = setTimeout(() => setOpen(true), 400);
        }}
        onPointerUp={() => {
          if (timer.current) clearTimeout(timer.current);
        }}
        onPointerLeave={() => {
          if (timer.current) clearTimeout(timer.current);
        }}
        whileTap={motionSafe.press}
        className="cursor-pointer"
      >
        {children}
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={
              motionSafe.reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 8, scale: 0.9 }
            }
            animate={
              motionSafe.reduce
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scale: 1 }
            }
            exit={
              motionSafe.reduce
                ? { opacity: 0 }
                : { opacity: 0, y: 8, scale: 0.9 }
            }
            transition={transitions.snappy}
            className="absolute bottom-full left-1/2 z-20 mb-2 flex -translate-x-1/2 gap-1 rounded-full border border-border/50 bg-surface-elevated px-2 py-1.5 shadow-lg"
            onMouseLeave={() => setOpen(false)}
          >
            {EMOJIS.map((emoji, i) => (
              <motion.button
                key={emoji}
                type="button"
                whileHover={
                  motionSafe.reduce ? undefined : { scale: 1.4, y: -6 }
                }
                transition={{
                  ...transitions.snappy,
                  delay: motionSafe.reduce ? 0 : i * 0.03,
                }}
                onClick={() => {
                  onReact(emoji);
                  setOpen(false);
                }}
                className="text-xl"
              >
                {emoji}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
