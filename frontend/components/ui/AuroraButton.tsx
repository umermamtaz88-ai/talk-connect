"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { motionTokens } from "@/lib/motion";

export function AuroraButton({
  children,
  onClick,
  loading,
  disabled,
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const { press, hoverLift, spring, reduce } = useMotionSafe();

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      whileTap={press}
      whileHover={hoverLift}
      transition={spring}
      className={cn(
        "relative overflow-hidden rounded-full px-6 py-3 font-medium text-white",
        "bg-[linear-gradient(135deg,#6E56CF_0%,#A78BFA_45%,#FF6B6B_100%)]",
        "shadow-[0_8px_24px_-8px_rgba(110,86,207,0.55)]",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {!reduce && (
        <motion.span
          className="pointer-events-none absolute inset-0 -skew-x-12 bg-white/25"
          initial={{ x: "-120%", opacity: 0 }}
          whileHover={{ x: "120%", opacity: 1 }}
          transition={{
            duration: motionTokens.duration.slow * 2,
            ease: "easeInOut",
          }}
          style={{ width: "40%" }}
        />
      )}
      <span className="relative flex items-center justify-center gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {children}
      </span>
    </motion.button>
  );
}
