"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { datePillLabel, formatMessageTime, isSameDay } from "@/lib/utils";
import { throttle } from "@/lib/throttle";
import type { Message } from "@/lib/types";

type Row =
  | { kind: "date"; key: string; label: string }
  | {
      kind: "msg";
      key: string;
      message: Message;
      mine: boolean;
      grouped: boolean;
      showTail: boolean;
      arrivalIndex: number;
    };

function buildRows(messages: Message[], myId?: string): Row[] {
  const out: Row[] = [];
  let burstStart = 0;
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    if (!prev || !isSameDay(prev.created_at, m.created_at)) {
      out.push({
        kind: "date",
        key: `d-${m.id}-${m.created_at}`,
        label: datePillLabel(m.created_at),
      });
    }
    if (
      !prev ||
      new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() >
        2000
    ) {
      burstStart = i;
    }
    const mine = m.sender_id === myId;
    const grouped =
      !!prev &&
      prev.sender_id === m.sender_id &&
      new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() <
        120_000;
    const showTail =
      !next ||
      next.sender_id !== m.sender_id ||
      new Date(next.created_at).getTime() - new Date(m.created_at).getTime() >=
        120_000;
    out.push({
      kind: "msg",
      key: m.clientId ?? m.id,
      message: m,
      mine,
      grouped,
      showTail,
      arrivalIndex: i - burstStart,
    });
  });
  return out;
}

export function MessageList({
  messages,
  myId,
  onRetry,
  onReply,
  onReload,
  autoTranslateLanguage,
}: {
  messages: Message[];
  myId?: string;
  onRetry?: (message: Message) => void;
  onReply?: (message: Message) => void;
  onReload?: () => void;
  autoTranslateLanguage?: string | null;
}) {
  const rows = useMemo(() => buildRows(messages, myId), [messages, myId]);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [showFab, setShowFab] = useState(false);
  const [scrubLabel, setScrubLabel] = useState<string | null>(null);
  const [scrubY, setScrubY] = useState(0);
  const atBottomRef = useRef(true);
  const scrubbing = useRef(false);

  const onBottomChange = useMemo(
    () =>
      throttle((bottom: boolean) => {
        atBottomRef.current = bottom;
        setShowFab(!bottom);
      }, 100),
    [],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    function onPointerDown(e: PointerEvent) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.right - 16) return;
      scrubbing.current = true;
    }
    function onPointerMove(e: PointerEvent) {
      if (!scrubbing.current || !el) return;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = Math.min(1, Math.max(0, y / rect.height));
      const idx = Math.floor(ratio * Math.max(messages.length - 1, 0));
      const m = messages[idx];
      if (m) {
        setScrubLabel(formatMessageTime(m.created_at));
        setScrubY(y);
      }
    }
    function onPointerUp() {
      scrubbing.current = false;
      setScrubLabel(null);
    }

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [messages]);

  const itemContent = useCallback(
    (_index: number, row: Row) => {
      if (row.kind === "date") {
        return (
          <div className="my-4 flex items-center gap-3 px-1">
            <div className="h-px flex-1 bg-border" />
            <span className="rounded-full border border-border bg-surface px-3 py-0.5 text-[11px] text-text-muted">
              {row.label}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
        );
      }
      return (
        <div className="px-1">
          <MessageBubble
            message={row.message}
            mine={row.mine}
            grouped={row.grouped}
            showTail={row.showTail}
            onRetry={onRetry}
            onReply={onReply}
            autoTranslateLanguage={autoTranslateLanguage}
            arrivalIndex={row.arrivalIndex}
          />
        </div>
      );
    },
    [onRetry, onReply, autoTranslateLanguage],
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-text-muted">No messages in this chat yet.</p>
        {onReload && (
          <button
            type="button"
            onClick={onReload}
            className="rounded-full border border-border px-4 py-2 text-xs text-brand-secondary hover:bg-surface-hover"
          >
            Reload messages
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative h-full min-h-0 w-full flex-1">
      <div className="absolute inset-0">
        <Virtuoso
          ref={virtuoso}
          data={rows}
          followOutput={() => (atBottomRef.current ? "auto" : false)}
          increaseViewportBy={{ top: 200, bottom: 120 }}
          className="h-full"
          atBottomStateChange={onBottomChange}
          itemContent={itemContent}
          computeItemKey={(_i, row) => row.key}
          initialTopMostItemIndex={Math.max(0, rows.length - 1)}
          components={{
            Footer: () => <div className="h-3" />,
            Header: () => <div className="h-2" />,
          }}
        />
      </div>
      {scrubLabel && (
        <div
          className="pointer-events-none absolute right-8 z-20 rounded-full border border-border bg-surface-elevated px-2.5 py-1 font-mono text-[11px] text-text-secondary shadow-lg"
          style={{ top: scrubY, transform: "translateY(-50%)" }}
        >
          {scrubLabel}
        </div>
      )}
      {showFab && (
        <button
          type="button"
          aria-label="Scroll to bottom"
          className="absolute right-4 bottom-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-elevated text-text-secondary shadow-lg"
          onClick={() => {
            virtuoso.current?.scrollToIndex({
              index: rows.length - 1,
              behavior: "smooth",
            });
            setShowFab(false);
            atBottomRef.current = true;
          }}
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  );
}
