"use client";

import { useEffect } from "react";
import { talkSocket } from "@/lib/ws";
import { useAuthStore } from "@/lib/stores/auth";
import { useAppStore } from "@/lib/stores/app";
import { playMessageNotification } from "@/lib/notify";
import { normalizeMessage } from "@/lib/normalize";
import type { PresenceState } from "@/lib/types";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return <>{children}</>;
}

function eventStr(
  data: Record<string, unknown>,
  snake: string,
  camel: string,
): string | undefined {
  const v = data[snake] ?? data[camel];
  return v != null ? String(v) : undefined;
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const upsertMessage = useAppStore((s) => s.upsertMessage);
  const removeMessage = useAppStore((s) => s.removeMessage);
  const patchMessage = useAppStore((s) => s.patchMessage);
  const setTyping = useAppStore((s) => s.setTyping);
  const setPresence = useAppStore((s) => s.setPresence);
  const setIncomingCall = useAppStore((s) => s.setIncomingCall);
  const setFocus = useAppStore((s) => s.setFocus);
  const bumpUnread = useAppStore((s) => s.bumpUnread);
  const upsertChat = useAppStore((s) => s.upsertChat);
  const loadChats = useAppStore((s) => s.loadChats);

  useEffect(() => {
    if (!user) return;

    const unsub = talkSocket.on((event) => {
      switch (event.type) {
        case "message.new": {
          const msg = normalizeMessage(event.data);
          if (!msg.id || !msg.chat_id) break;
          upsertMessage(msg);
          const fromOther = msg.sender_id !== user.id;
          if (fromOther) {
            const activeId = useAppStore.getState().activeChatId;
            const viewingChat =
              msg.chat_id === activeId &&
              typeof document !== "undefined" &&
              !document.hidden;
            if (!viewingChat) {
              playMessageNotification();
            }
            if (msg.chat_id !== activeId) {
              bumpUnread(msg.chat_id);
            }
          }
          break;
        }
        case "message.ack": {
          const data = event.data;
          const messageId = eventStr(data, "message_id", "messageId");
          const chatId = eventStr(data, "chat_id", "chatId");
          if (messageId && chatId) {
            patchMessage(chatId, messageId, { localStatus: "sent" });
          }
          break;
        }
        case "message.edited": {
          const msg = normalizeMessage(event.data);
          if (msg?.id) upsertMessage(msg);
          break;
        }
        case "message.deleted": {
          const data = event.data;
          const messageId = eventStr(data, "message_id", "messageId");
          const chatId = eventStr(data, "chat_id", "chatId");
          if (messageId && chatId) removeMessage(chatId, messageId);
          break;
        }
        case "message.reaction": {
          const data = event.data;
          const messageId = eventStr(data, "message_id", "messageId");
          const chatId = eventStr(data, "chat_id", "chatId");
          const userId = eventStr(data, "user_id", "userId");
          const emoji = data.emoji != null ? String(data.emoji) : "";
          if (!messageId || !chatId || !userId || !emoji) break;
          const thread = useAppStore.getState().messages[chatId] ?? [];
          const target = thread.find((m) => m.id === messageId);
          if (!target) break;
          const without = (target.reactions ?? []).filter(
            (r) => r.user_id !== userId,
          );
          patchMessage(chatId, messageId, {
            reactions: [...without, { user_id: userId, emoji }],
          });
          break;
        }
        case "typing": {
          const data = event.data;
          const chatId = eventStr(data, "chat_id", "chatId");
          const userId = eventStr(data, "user_id", "userId");
          const isTyping = Boolean(
            data.isTyping ?? data.is_typing ?? true,
          );
          if (chatId && userId && userId !== user.id) {
            setTyping(chatId, userId, isTyping);
          }
          break;
        }
        case "presence": {
          const data = event.data;
          const userId = eventStr(data, "user_id", "userId");
          const state = (data.state as PresenceState) ?? "offline";
          if (userId) setPresence(userId, state);
          break;
        }
        case "call.incoming": {
          setIncomingCall({
            callId: String(event.data.callId ?? event.data.call_id),
            fromUserId: String(
              event.data.fromUserId ?? event.data.from_user_id,
            ),
            callType: (event.data.callType ??
              event.data.call_type) as "audio" | "video",
            chatId: String(event.data.chatId ?? event.data.chat_id),
          });
          break;
        }
        case "call.ended": {
          setIncomingCall(null);
          break;
        }
        case "focus.updated": {
          const userId = eventStr(event.data, "user_id", "userId");
          if (userId) {
            setFocus(userId, {
              until: event.data.until as string | undefined,
              message: event.data.message as string | undefined,
            });
          }
          break;
        }
        case "chat.new":
        case "chat.added": {
          // Patch in place when possible; otherwise soft-reload list once
          const chatId = eventStr(event.data, "chat_id", "chatId");
          if (chatId && !useAppStore.getState().chats.some((c) => c.id === chatId)) {
            void loadChats();
          }
          break;
        }
        case "friend.accepted":
        case "friend.request": {
          void loadChats();
          break;
        }
        case "auth.expired": {
          void useAuthStore.getState().logout();
          break;
        }
        case "location.update": {
          const data = event.data;
          const shareId = String(
            data.locationShareId ?? data.location_share_id ?? data.shareId ?? "",
          );
          if (!shareId) break;
          const lat = Number(data.latitude);
          const lng = Number(data.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) break;
          const accuracy =
            data.accuracyMeters != null
              ? Number(data.accuracyMeters)
              : data.accuracy_meters != null
                ? Number(data.accuracy_meters)
                : undefined;
          const threads = useAppStore.getState().messages;
          for (const [chatId, msgs] of Object.entries(threads)) {
            const target = msgs.find((m) => m.location_share?.id === shareId);
            if (!target?.location_share) continue;
            patchMessage(chatId, target.id, {
              location_share: {
                ...target.location_share,
                latitude: lat,
                longitude: lng,
                accuracy_meters:
                  accuracy ?? target.location_share.accuracy_meters,
                last_updated_at: new Date().toISOString(),
              },
            });
            break;
          }
          break;
        }
        case "location.stopped": {
          const data = event.data;
          const shareId = String(
            data.locationShareId ?? data.location_share_id ?? data.shareId ?? "",
          );
          if (!shareId) break;
          const reason = String(data.reason ?? "stopped_by_sender");
          const threads = useAppStore.getState().messages;
          for (const [chatId, msgs] of Object.entries(threads)) {
            const target = msgs.find((m) => m.location_share?.id === shareId);
            if (!target?.location_share) continue;
            patchMessage(chatId, target.id, {
              location_share: {
                ...target.location_share,
                status: reason === "expired" ? "expired" : "stopped",
                stopped_early: reason !== "expired",
              },
            });
            break;
          }
          break;
        }
        default:
          break;
      }
    });

    return () => {
      unsub();
    };
  }, [
    user,
    upsertMessage,
    removeMessage,
    patchMessage,
    setTyping,
    setPresence,
    setIncomingCall,
    setFocus,
    bumpUnread,
    upsertChat,
    loadChats,
  ]);

  return <>{children}</>;
}
