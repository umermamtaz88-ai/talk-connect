"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { datePillLabel, isSameDay } from "@/lib/utils";
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
    };

function buildRows(messages: Message[], myId?: string): Row[] {
  const out: Row[] = [];
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
    });
  });
  return out;
}

export function MessageList({
  messages,
  myId,
  onRetry,
  autoTranslateLanguage,
}: {
  messages: Message[];
  myId?: string;
  onRetry?: (message: Message) => void;
  autoTranslateLanguage?: string | null;
}) {
  const rows = useMemo(() => buildRows(messages, myId), [messages, myId]);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [showFab, setShowFab] = useState(false);
  const atBottomRef = useRef(true);

  const onBottomChange = useMemo(
    () =>
      throttle((bottom: boolean) => {
        atBottomRef.current = bottom;
        setShowFab(!bottom);
      }, 100),
    [],
  );

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
            autoTranslateLanguage={autoTranslateLanguage}
          />
        </div>
      );
    },
    [onRetry, autoTranslateLanguage],
  );

  return (
    <div className="relative h-full min-h-0 flex-1">
      <Virtuoso
        ref={virtuoso}
        data={rows}
        followOutput={() => (atBottomRef.current ? "auto" : false)}
        increaseViewportBy={{ top: 200, bottom: 120 }}
        className="h-full"
        atBottomStateChange={onBottomChange}
        itemContent={itemContent}
        computeItemKey={(_i, row) => row.key}
        components={{
          Footer: () => <div className="h-3" />,
          Header: () => <div className="h-2" />,
        }}
      />
      {showFab && (
        <button
          type="button"
          aria-label="Scroll to bottom"
          className="absolute right-4 bottom-4 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-elevated text-text-secondary shadow-lg"
          style={{ transition: "opacity 150ms" }}
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
