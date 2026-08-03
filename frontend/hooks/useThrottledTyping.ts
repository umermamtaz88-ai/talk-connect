"use client";

import { useEffect, useMemo, useRef } from "react";
import { talkSocket } from "@/lib/ws";
import { throttle } from "@/lib/throttle";

/**
 * Composer only pings WS "typing" at most every 2s.
 * UI still feels instant; network stays calm.
 */
export function useThrottledTyping(chatId: string) {
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const send = useMemo(
    () =>
      throttle((isTyping: boolean) => {
        talkSocket.send({
          type: "typing",
          data: { chatId: chatIdRef.current, isTyping },
        });
      }, 2000),
    [],
  );

  useEffect(() => {
    return () => {
      send(false);
      send.cancel();
    };
  }, [send, chatId]);

  return {
    typingOn: () => send(true),
    typingOff: () => {
      send.cancel();
      talkSocket.send({
        type: "typing",
        data: { chatId: chatIdRef.current, isTyping: false },
      });
    },
  };
}
