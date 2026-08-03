"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { motionTokens, transitions } from "@/lib/motion";
import { useMotionSafe } from "@/hooks/useMotionSafe";

export function IconOrbButton({
  children,
  onClick,
  active,
  danger,
  ariaLabel,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const { reduce } = useMotionSafe();
  const bgClass = danger
    ? "bg-danger"
    : active
      ? "bg-brand-primary"
      : "bg-surface-elevated";

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full text-white transition-opacity",
        bgClass,
        className,
      )}
    >
      <motion.div
        key={String(danger) + String(active)}
        initial={reduce ? false : { scale: 0.85, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={
          reduce
            ? { duration: motionTokens.duration.fast }
            : transitions.snappy
        }
      >
        {children}
      </motion.div>
    </button>
  );
}
