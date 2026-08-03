"use client";

/** Layout-matched bubble skeletons — CSS pulse only, no JS animation loop. */
export function ThreadSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4" aria-hidden>
      {[60, 40, 75, 30, 55, 45].map((w, i) => (
        <div
          key={i}
          className="h-10 rounded-2xl bg-surface-elevated"
          style={{ width: `${w}%`, marginLeft: i % 2 ? "auto" : 0 }}
        />
      ))}
    </div>
  );
}

export function ChatListSkeleton() {
  return (
    <div className="animate-pulse space-y-2 px-2 py-2" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl px-3 py-3">
          <div className="h-12 w-12 shrink-0 rounded-full bg-surface-elevated" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-1/2 rounded bg-surface-elevated" />
            <div className="h-2.5 w-3/4 rounded bg-surface-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FriendsSkeleton() {
  return (
    <div className="animate-pulse space-y-2 p-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="h-11 w-11 rounded-full bg-surface-elevated" />
          <div className="h-3 w-32 rounded bg-surface-elevated" />
        </div>
      ))}
    </div>
  );
}
