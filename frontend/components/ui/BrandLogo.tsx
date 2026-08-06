"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  /** full = wordmark lockup; mark = compact square for nav; fill = cover a parent */
  variant?: "full" | "mark" | "fill";
  className?: string;
  priority?: boolean;
};

export function BrandLogo({
  variant = "full",
  className,
  priority,
}: BrandLogoProps) {
  if (variant === "mark") {
    return (
      <Image
        src="/logo.jpg"
        alt="TALK-CONNECT"
        width={40}
        height={40}
        priority={priority}
        className={cn(
          "h-10 w-10 rounded-xl object-cover object-center",
          className,
        )}
      />
    );
  }

  if (variant === "fill") {
    return (
      <Image
        src="/logo.jpg"
        alt="TALK-CONNECT — Connect every conversation"
        fill
        priority={priority}
        sizes="(max-width: 1024px) 100vw, 55vw"
        className={cn("object-cover object-center", className)}
      />
    );
  }

  return (
    <Image
      src="/logo.jpg"
      alt="TALK-CONNECT — Connect every conversation"
      width={1200}
      height={675}
      priority={priority}
      className={cn("h-auto w-full object-contain", className)}
    />
  );
}
