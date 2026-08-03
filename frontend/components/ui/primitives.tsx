"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white",
        className,
      )}
    />
  );
}

export function TypingDots() {
  return (
    <div className="flex gap-1 px-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-text-secondary"
          animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

export function InputField({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      {label ? (
        <span className="text-xs font-medium text-text-secondary">{label}</span>
      ) : null}
      <input
        className={cn(
          "w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary outline-none transition",
          "placeholder:text-text-muted focus:border-brand-primary",
          className,
        )}
        {...props}
      />
    </label>
  );
}
