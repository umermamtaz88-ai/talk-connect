"use client";

import { create } from "zustand";
import { chatsApi, messagesApi } from "../api";
import type { Chat, Message, PresenceState, StatusFeedItem } from "../types";

interface AppState {
  chats: Chat[];
  activeChatId: string | null;
  messages: Record<string, Message[]>;
  messagesLoading: Record<string, boolean>;
  typing: Record<string, string[]>;
  presence: Record<string, PresenceState>;
  statusFeed: StatusFeedItem[];
  incomingCall: {
    callId: string;
    fromUserId: string;
    callType: "audio" | "video";
    chatId: string;
  } | null;
  focusMap: Record<string, { until?: string; message?: string }>;

  setActiveChat: (id: string | null) => void;
  loadChats: () => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  prefetchMessages: (chatId: string) => Promise<void>;
  upsertMessage: (msg: Message) => void;
  replaceOptimistic: (clientId: string, msg: Message) => void;
  markMessageFailed: (chatId: string, clientId: string) => void;
  patchMessage: (
    chatId: string,
    messageId: string,
    patch: Partial<Message>,
  ) => void;
  removeMessage: (chatId: string, messageId: string) => void;
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void;
  setPresence: (userId: string, state: PresenceState) => void;
  setStatusFeed: (feed: StatusFeedItem[]) => void;
  setIncomingCall: (call: AppState["incomingCall"]) => void;
  setFocus: (
    userId: string,
    data: { until?: string; message?: string } | null,
  ) => void;
  bumpUnread: (chatId: string) => void;
  clearUnread: (chatId: string) => void;
  upsertChat: (chat: Chat) => void;
}

function mergeMessage(prev: Message[], msg: Message): Message[] {
  const byId = prev.findIndex((m) => m.id === msg.id);
  if (byId >= 0) {
    return prev.map((m, i) =>
      i === byId
        ? {
            ...m,
            ...msg,
            localStatus: msg.localStatus ?? m.localStatus ?? "sent",
            clientId: msg.clientId ?? m.clientId,
          }
        : m,
    );
  }

  const clientKey =
    msg.clientId ?? (msg.id.startsWith("opt-") ? msg.id : undefined);
  if (clientKey) {
    const byClient = prev.findIndex(
      (m) => m.clientId === clientKey || m.id === clientKey,
    );
    if (byClient >= 0) {
      return prev.map((m, i) =>
        i === byClient
          ? {
              ...msg,
              localStatus: msg.localStatus ?? "sent",
              clientId: clientKey,
            }
          : m,
      );
    }
  }

  // WS echo of our own send arrives without clientId while the optimistic
  // bubble is still pending — reclaim it instead of appending a duplicate.
  if (msg.localStatus !== "pending") {
    const pendingIdx = prev.findIndex(
      (m) =>
        m.sender_id === msg.sender_id &&
        (m.localStatus === "pending" ||
          m.id.startsWith("opt-") ||
          Boolean(m.clientId?.startsWith("opt-"))) &&
        m.type === msg.type &&
        (m.body ?? "") === (msg.body ?? ""),
    );
    if (pendingIdx >= 0) {
      const pending = prev[pendingIdx];
      return prev.map((m, i) =>
        i === pendingIdx
          ? {
              ...msg,
              localStatus: "sent" as const,
              clientId: pending.clientId ?? msg.clientId,
            }
          : m,
      );
    }
  }

  return [...prev, msg];
}

function dedupeById(messages: Message[]): Message[] {
  const seen = new Set<string>();
  const out: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.reverse();
}

export const useAppStore = create<AppState>((set, get) => ({
  chats: [],
  activeChatId: null,
  messages: {},
  messagesLoading: {},
  typing: {},
  presence: {},
  statusFeed: [],
  incomingCall: null,
  focusMap: {},

  setActiveChat: (id) => set({ activeChatId: id }),

  loadChats: async () => {
    const CACHE_KEY = "tc_chats_cache";
    if (typeof window !== "undefined" && get().chats.length === 0) {
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as Chat[];
          if (Array.isArray(cached) && cached.length) set({ chats: cached });
        }
      } catch {
        /* ignore */
      }
    }
    const chats = await chatsApi.list();
    set({ chats });
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(chats));
      } catch {
        /* ignore quota */
      }
    }
  },

  loadMessages: async (chatId) => {
    if (chatId.startsWith("__")) return;
    const cached = get().messages[chatId];
    if (!cached?.length) {
      set((s) => ({
        messagesLoading: { ...s.messagesLoading, [chatId]: true },
      }));
    }
    try {
      const list = await messagesApi.list(chatId, { limit: 80 });
      const ordered = list.map((m) => ({ ...m, localStatus: "sent" as const }));
      set((s) => ({
        messages: { ...s.messages, [chatId]: ordered },
        messagesLoading: { ...s.messagesLoading, [chatId]: false },
      }));
    } catch {
      // Keep any cached messages; surface empty + not-loading so UI can retry
      set((s) => ({
        messagesLoading: { ...s.messagesLoading, [chatId]: false },
        messages: {
          ...s.messages,
          [chatId]: s.messages[chatId] ?? [],
        },
      }));
    }
  },

  prefetchMessages: async (chatId) => {
    if (get().messages[chatId]?.length) return;
    try {
      const list = await messagesApi.list(chatId, { limit: 40 });
      const ordered = list.map((m) => ({ ...m, localStatus: "sent" as const }));
      set((s) => ({
        messages: { ...s.messages, [chatId]: ordered },
      }));
    } catch {
      /* ignore prefetch errors */
    }
  },

  upsertMessage: (msg) => {
    set((s) => {
      const next = dedupeById(
        mergeMessage(s.messages[msg.chat_id] ?? [], {
          ...msg,
          localStatus: msg.localStatus ?? "sent",
        }),
      );
      const chats = s.chats.map((c) =>
        c.id === msg.chat_id ? { ...c, last_message: msg } : c,
      );
      return { messages: { ...s.messages, [msg.chat_id]: next }, chats };
    });
  },

  replaceOptimistic: (clientId, msg) => {
    set((s) => {
      const prev = s.messages[msg.chat_id] ?? [];
      const withoutOpt = prev.filter(
        (m) => m.clientId !== clientId && m.id !== clientId,
      );
      // Prefer merge so a WS copy that already landed doesn't create a twin.
      const next = dedupeById(
        mergeMessage(withoutOpt, {
          ...msg,
          localStatus: "sent",
          clientId,
        }),
      );
      return {
        messages: { ...s.messages, [msg.chat_id]: next },
        chats: s.chats.map((c) =>
          c.id === msg.chat_id ? { ...c, last_message: msg } : c,
        ),
      };
    });
  },

  markMessageFailed: (chatId, clientId) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).map((m) =>
          m.clientId === clientId || m.id === clientId
            ? { ...m, localStatus: "failed" as const }
            : m,
        ),
      },
    }));
  },

  patchMessage: (chatId, messageId, patch) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).map((m) =>
          m.id === messageId ? { ...m, ...patch } : m,
        ),
      },
    }));
  },

  removeMessage: (chatId, messageId) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).map((m) =>
          m.id === messageId
            ? { ...m, deleted_at: new Date().toISOString(), body: null }
            : m,
        ),
      },
    }));
  },

  setTyping: (chatId, userId, isTyping) => {
    set((s) => {
      const cur = s.typing[chatId] ?? [];
      const next = isTyping
        ? cur.includes(userId)
          ? cur
          : [...cur, userId]
        : cur.filter((id) => id !== userId);
      return { typing: { ...s.typing, [chatId]: next } };
    });
  },

  setPresence: (userId, state) =>
    set((s) => ({ presence: { ...s.presence, [userId]: state } })),

  setStatusFeed: (feed) => set({ statusFeed: feed }),

  setIncomingCall: (call) => set({ incomingCall: call }),

  setFocus: (userId, data) =>
    set((s) => {
      const next = { ...s.focusMap };
      if (!data) delete next[userId];
      else next[userId] = data;
      return { focusMap: next };
    }),

  bumpUnread: (chatId) =>
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId
          ? { ...c, unread_count: (c.unread_count ?? 0) + 1 }
          : c,
      ),
    })),

  clearUnread: (chatId) =>
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, unread_count: 0 } : c,
      ),
    })),

  upsertChat: (chat) =>
    set((s) => {
      const exists = s.chats.some((c) => c.id === chat.id);
      return {
        chats: exists
          ? s.chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c))
          : [chat, ...s.chats],
      };
    }),
}));
