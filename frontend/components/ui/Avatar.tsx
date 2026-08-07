"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

const ICON_GRADIENTS = [
  "from-[#6E56CF] to-[#FF6B6B]",
  "from-[#2DD4BF] to-[#6E56CF]",
  "from-[#FF6B6B] to-[#F59E0B]",
  "from-[#A78BFA] to-[#2DD4BF]",
  "from-[#F59E0B] to-[#FF6B6B]",
  "from-[#6E56CF] to-[#2DD4BF]",
  "from-[#A78BFA] to-[#FF6B6B]",
  "from-[#2DD4BF] to-[#F59E0B]",
];

export function Avatar({
  name,
  url,
  iconId,
  size = 40,
  className,
}: {
  name?: string;
  url?: string | null;
  iconId?: string | null;
  size?: number;
  className?: string;
}) {
  const label = (name ?? "?").trim();
  const parts = label.split(/\s+/).filter(Boolean);
  let initial = "?";
  if (parts.length >= 2) {
    initial = (parts[0][0] + parts[1][0]).toUpperCase();
  } else if (/^\d+$/.test(label)) {
    initial = label.slice(0, 2);
  } else if (label.length >= 2) {
    initial = label.slice(0, 2).toUpperCase();
  } else if (label.length === 1) {
    initial = label.toUpperCase();
  }
  const grad =
    ICON_GRADIENTS[
      Math.abs((iconId ?? name ?? "a").charCodeAt(0)) % ICON_GRADIENTS.length
    ];

  if (url) {
    return (
      <Image
        src={url}
        alt={name ?? "avatar"}
        width={size}
        height={size}
        unoptimized
        className={cn("rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-medium text-white",
        grad,
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initial}
    </div>
  );
}

export type RingState = "online" | "unseen" | "focus" | "none";

export function AvatarRing({
  state,
  children,
}: {
  state: RingState;
  children: React.ReactNode;
}) {
  if (state === "none") return <>{children}</>;

  if (state === "online") {
    return (
      <div className="rounded-full p-[2px] ring-2 ring-success">{children}</div>
    );
  }

  if (state === "focus") {
    return (
      <div className="rounded-full border-2 border-dashed border-warning p-[2px]">
        {children}
      </div>
    );
  }

  return <div className="status-ring-unseen">{children}</div>;
}
