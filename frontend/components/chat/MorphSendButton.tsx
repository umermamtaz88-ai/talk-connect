"use client";

import { Loader2, Mic, Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComposerState = "idle" | "typing" | "sending" | "recording";

/** Always-visible mic + send — never morph into each other or hide the mic. */
export function ComposerActions({
  state,
  onSend,
  onMicPress,
  disabled,
}: {
  state: ComposerState;
  onSend: () => void;
  onMicPress: () => void;
  disabled?: boolean;
}) {
  const recording = state === "recording";
  const sending = state === "sending";

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        disabled={disabled || sending}
        onClick={onMicPress}
        aria-label={recording ? "Stop and send voice note" : "Record voice note"}
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full text-white",
          recording ? "bg-danger" : "bg-brand-primary",
          (disabled || sending) && "opacity-50",
        )}
      >
        {recording ? (
          <Square size={16} className="fill-white text-white" />
        ) : (
          <Mic size={18} className="text-white" />
        )}
      </button>
      <button
        type="button"
        disabled={disabled || sending || state === "recording" || state === "idle"}
        onClick={onSend}
        aria-label="Send message"
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full bg-brand-primary text-white",
          (disabled || sending || state === "recording" || state === "idle") &&
            "opacity-40",
        )}
      >
        {sending ? (
          <Loader2 size={18} className="animate-spin text-white" />
        ) : (
          <Send size={18} className="text-white" />
        )}
      </button>
    </div>
  );
}

/** Back-compat wrapper used by AI thread (send only). */
export function MorphSendButton({
  state,
  onSend,
  onMicPress,
}: {
  state: ComposerState;
  onSend: () => void;
  onMicPress?: () => void;
}) {
  if (onMicPress) {
    return (
      <ComposerActions state={state} onSend={onSend} onMicPress={onMicPress} />
    );
  }
  return (
    <button
      type="button"
      onClick={state === "typing" || state === "idle" ? onSend : undefined}
      disabled={state === "sending"}
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-primary"
      aria-label="Send message"
    >
      {state === "sending" ? (
        <Loader2 size={18} className="animate-spin text-white" />
      ) : (
        <Send size={18} className="text-white" />
      )}
    </button>
  );
}
