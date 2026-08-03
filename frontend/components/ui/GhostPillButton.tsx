"use client";

import { cn } from "@/lib/utils";

export function GhostPillButton({
  children,
  onClick,
  disabled,
  className,
  type = "button",
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  danger?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-5 py-2.5 text-sm transition-colors duration-150",
        "border-border text-text-secondary",
        danger
          ? "hover:border-danger hover:text-danger"
          : "hover:border-brand-primary hover:text-brand-primary",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
