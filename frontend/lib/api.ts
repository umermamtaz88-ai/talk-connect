import { API_BASE } from "./config";
import {
  normalizeChat,
  normalizeLocationShare,
  normalizeMessage,
  normalizeStatusFeedItem,
} from "./normalize";
import type {
  Call,
  Chat,
  FriendRequest,
  Message,
  StatusFeedItem,
  StatusPost,
  User,
  VaultTransfer,
} from "./types";

const TOKEN_KEY = "tc_access_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  auth?: boolean;
  headers?: Record<string, string>;
  /** Request timeout in ms (default 12s) — prevents infinite home-screen spinner */
  timeoutMs?: number;
  /** Skip the single 401→refresh→retry cycle */
  _retried?: boolean;
};

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const data = (await res.json()) as { access_token: string };
      setAccessToken(data.access_token);
      // Keep realtime alive with the new JWT
      try {
        const { talkSocket } = await import("./ws");
        talkSocket.connect(data.access_token);
      } catch {
        /* ignore */
      }
      return data.access_token;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function formatApiDetail(data: unknown, status: number): string {
  if (!data || typeof data !== "object") {
    return `Request failed (${status})`;
  }
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const obj = detail as { message?: unknown; code?: unknown };
    if (typeof obj.message === "string") return obj.message;
  }
  if (Array.isArray(detail) && detail.length) {
    const parts = detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "msg" in item) {
        const loc = Array.isArray((item as { loc?: unknown }).loc)
          ? (item as { loc: unknown[] }).loc.filter((x) => x !== "body").join(".")
          : "";
        const msg = String((item as { msg: unknown }).msg);
        return loc ? `${loc}: ${msg}` : msg;
      }
      return null;
    });
    const joined = parts.filter(Boolean).join("; ");
    if (joined) return joined;
  }
  return `Request failed (${status})`;
}

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    formData,
    auth = true,
    headers = {},
    timeoutMs = 12_000,
    _retried = false,
  } = options;
  const h: Record<string, string> = { ...headers };

  if (!formData && body !== undefined) {
    h["Content-Type"] = "application/json";
  }

  if (auth) {
    const token = getAccessToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: h,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
      credentials: "include",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(408, "Request timed out — check your connection");
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Silent refresh + one retry on expired access tokens
  if (res.status === 401 && auth && !_retried) {
    const next = await refreshAccessToken();
    if (next) {
      return api<T>(path, { ...options, _retried: true });
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, formatApiDetail(data, res.status), data);
  }

  return data as T;
}

export const authApi = {
  register: (body: {
    username: string;
    email: string;
    password: string;
    display_name: string;
    phone?: string;
  }) =>
    api<{
      message: string;
      user_id: string;
      email?: string;
      emailed?: boolean;
      verification_code?: string;
    }>("/auth/register", { method: "POST", body, auth: false }),

  verify: (body: { email: string; code: string }) =>
    api<{ message: string }>("/auth/verify", {
      method: "POST",
      body,
      auth: false,
    }),

  verifyEmail: (body: {
    email: string;
    code: string;
    device_name?: string;
  }) =>
    api<{ access_token: string; token_type: string; expires_in: number }>(
      "/auth/verify-email",
      {
        method: "POST",
        body: {
          email: body.email,
          code: body.code,
          deviceName: body.device_name,
        },
        auth: false,
      },
    ),

  resendVerification: (email: string) =>
    api<{
      message: string;
      emailed?: boolean;
      verification_code?: string;
    }>("/auth/resend-otp", {
      method: "POST",
      body: { email },
      auth: false,
    }),

  login: (body: {
    email: string;
    password: string;
    device_name?: string;
    totp_code?: string;
  }) =>
    api<{ access_token: string; token_type: string; expires_in: number }>(
      "/auth/login",
      { method: "POST", body, auth: false },
    ),

  refresh: (opts?: { timeoutMs?: number }) =>
    api<{ access_token: string; token_type: string; expires_in: number }>(
      "/auth/refresh",
      { method: "POST", auth: false, timeoutMs: opts?.timeoutMs },
    ),

  logout: () => api("/auth/logout", { method: "POST" }),
  logoutAll: () => api("/auth/logout-all", { method: "POST" }),
  me: (opts?: { timeoutMs?: number }) =>
    api<User>("/auth/me", { timeoutMs: opts?.timeoutMs }),

  forgotPassword: (email: string) =>
    api<{ message: string; reset_token?: string }>("/auth/forgot-password", {
      method: "POST",
      body: { email },
      auth: false,
    }),

  resetPassword: (token: string, new_password: string) =>
    api<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: { token, new_password },
      auth: false,
    }),

  setup2fa: () =>
    api<{ secret: string; provisioning_uri: string }>("/auth/2fa/setup", {
      method: "POST",
    }),

  confirm2fa: (code: string) =>
    api<{ message: string }>("/auth/2fa/confirm", {
      method: "POST",
      body: { code },
    }),

  disable2fa: (code: string, password: string) =>
    api<{ message: string }>("/auth/2fa/disable", {
      method: "POST",
      body: { code, password },
    }),
};

export const usersApi = {
  search: (q: string) =>
    api<User[]>(`/users/search?q=${encodeURIComponent(q)}`),
  get: (id: string) => api<User>(`/users/${id}`),
  updateMe: (body: Record<string, unknown>) =>
    api<User>("/users/me", { method: "PATCH", body }),
  setAvatar: (body: { avatar_url?: string; avatar_video_url?: string }) =>
    api("/users/me/avatar", { method: "POST", body }),
  setAvatarIcon: (avatarIconId: string) =>
    api("/users/me/avatar/icon", {
      method: "POST",
      body: { avatarIconId },
    }),
  avatarIcons: () =>
    api<{ id: string; name: string; gradient?: string }[]>(
      "/users/avatar-icons",
    ),
  setCover: (cover_photo_url: string) =>
    api("/users/me/cover-photo", {
      method: "POST",
      body: { cover_photo_url },
    }),
  setFocus: (body: {
    until?: string;
    message?: string;
    shareWith?: string[];
  }) => api("/users/me/focus", { method: "POST", body }),
  clearFocus: () => api("/users/me/focus", { method: "DELETE" }),
  exportData: () => api("/users/me/export", { method: "POST" }),
  deleteMe: () => api("/users/me", { method: "DELETE" }),
};

export const friendsApi = {
  list: () => api<User[]>("/friends"),
  requests: (direction: "incoming" | "outgoing" = "incoming") =>
    api<FriendRequest[]>(`/friends/requests?direction=${direction}`),
  send: (toUserId: string) =>
    api("/friends/requests", { method: "POST", body: { toUserId } }),
  accept: (id: string) =>
    api(`/friends/requests/${id}/accept`, { method: "POST" }),
  decline: (id: string) =>
    api(`/friends/requests/${id}/decline`, { method: "POST" }),
  cancel: (id: string) => api(`/friends/requests/${id}`, { method: "DELETE" }),
  unfriend: (userId: string) =>
    api(`/friends/${userId}`, { method: "DELETE" }),
  block: (userId: string) =>
    api(`/friends/${userId}/block`, { method: "POST" }),
  unblock: (userId: string) =>
    api(`/friends/${userId}/block`, { method: "DELETE" }),
  blocked: () => api<User[]>("/friends/blocked"),
  report: (
    userId: string,
    body: { reason: string; details?: string; alsoBlock?: boolean },
  ) =>
    api<{ id: string; message: string; blocked?: boolean }>(
      `/users/${userId}/report`,
      { method: "POST", body },
    ),
  syncContacts: (phone_hashes: string[]) =>
    api("/contacts/sync", { method: "POST", body: { phone_hashes } }),
};

export const chatsApi = {
  list: async () => {
    const rows = await api<unknown[]>("/chats");
    return rows.map(normalizeChat) as Chat[];
  },
  get: async (id: string) => normalizeChat(await api(`/chats/${id}`)),
  direct: async (userId: string) =>
    normalizeChat(
      await api("/chats/direct", {
        method: "POST",
        body: { userId },
      }),
    ),
  createGroup: async (
    name: string,
    memberUserIds: string[],
    opts?: { description?: string; isCommunity?: boolean },
  ) =>
    normalizeChat(
      await api("/chats/groups", {
        method: "POST",
        body: {
          name,
          memberUserIds,
          description: opts?.description,
          isCommunity: opts?.isCommunity ?? false,
        },
      }),
    ),
  notesToSelf: async () =>
    normalizeChat(await api("/chats/notes-to-self")),
  update: async (id: string, body: Record<string, unknown>) =>
    normalizeChat(await api(`/chats/${id}`, { method: "PATCH", body })),
  leave: (id: string) => api(`/chats/${id}/leave`, { method: "POST" }),
  addMembers: (id: string, userIds: string[]) =>
    api(`/chats/${id}/members`, { method: "POST", body: { userIds } }),
};

export const messagesApi = {
  list: async (chatId: string, params?: { limit?: number; before?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.before) q.set("before", params.before);
    const qs = q.toString();
    const rows = await api<unknown[]>(
      `/chats/${chatId}/messages${qs ? `?${qs}` : ""}`,
    );
    return rows.map(normalizeMessage) as Message[];
  },
  send: async (
    chatId: string,
    body: {
      body?: string;
      type?: string;
      replyToId?: string;
      codeLanguage?: string;
      transcript?: string;
      viewOnce?: boolean;
      context?: string;
      attachments?: Record<string, unknown>[];
    },
  ) =>
    normalizeMessage(
      await api(`/chats/${chatId}/messages`, {
        method: "POST",
        body,
      }),
    ),
  search: async (chatId: string, q: string) => {
    const rows = await api<unknown[]>(
      `/chats/${chatId}/messages/search?q=${encodeURIComponent(q)}`,
    );
    return rows.map(normalizeMessage) as Message[];
  },
  edit: (id: string, body: string) =>
    api(`/messages/${id}`, { method: "PATCH", body: { body } }),
  remove: (id: string) => api(`/messages/${id}`, { method: "DELETE" }),
  forward: (id: string, targetChatId: string) =>
    api(`/messages/${id}/forward`, {
      method: "POST",
      body: { targetChatId },
    }),
  read: (id: string) => api(`/messages/${id}/read`, { method: "POST" }),
  react: (id: string, emoji: string) =>
    api(`/messages/${id}/react`, { method: "POST", body: { emoji } }),
  unreact: (id: string) =>
    api(`/messages/${id}/react`, { method: "DELETE" }),
  translate: (id: string, targetLanguage: string) =>
    api<{
      messageId: string;
      targetLanguage: string;
      sourceLanguage: string | null;
      translatedText: string;
    }>(`/messages/${id}/translate`, {
      method: "POST",
      body: { targetLanguage },
    }),
};

export const locationApi = {
  sendStatic: async (
    chatId: string,
    body: {
      latitude: number;
      longitude: number;
      accuracyMeters?: number;
    },
  ) =>
    normalizeMessage(
      await api(`/chats/${chatId}/messages/location`, {
        method: "POST",
        body,
      }),
    ) as import("./types").Message,

  startLive: async (
    chatId: string,
    body: {
      latitude: number;
      longitude: number;
      durationMinutes: number;
      accuracyMeters?: number;
    },
  ) =>
    normalizeMessage(
      await api(`/chats/${chatId}/messages/location/live`, {
        method: "POST",
        body,
      }),
    ) as import("./types").Message,

  update: async (
    shareId: string,
    body: {
      latitude: number;
      longitude: number;
      accuracyMeters?: number;
    },
  ) => {
    const raw = await api(`/location-shares/${shareId}`, {
      method: "PATCH",
      body,
    });
    return normalizeLocationShare(raw)!;
  },

  stop: async (shareId: string) => {
    const raw = await api(`/location-shares/${shareId}/stop`, {
      method: "POST",
    });
    return normalizeLocationShare(raw)!;
  },

  get: async (shareId: string) => {
    const raw = await api(`/location-shares/${shareId}`);
    return normalizeLocationShare(raw)!;
  },
};

export const statusApi = {
  create: (body: Record<string, unknown>) =>
    api<StatusPost>("/status", { method: "POST", body }),
  feed: async () => {
    const rows = await api<unknown[]>("/status/feed");
    return rows.map(normalizeStatusFeedItem) as StatusFeedItem[];
  },
  get: (id: string) => api<StatusPost>(`/status/${id}`),
  remove: (id: string) => api(`/status/${id}`, { method: "DELETE" }),
  view: (id: string) => api(`/status/${id}/view`, { method: "POST" }),
  views: (id: string) => api(`/status/${id}/views`),
  react: (id: string, emoji: string) =>
    api(`/status/${id}/react`, { method: "POST", body: { emoji } }),
  unreact: (id: string) =>
    api(`/status/${id}/react`, { method: "DELETE" }),
  reactions: (id: string) => api(`/status/${id}/reactions`),
  reply: (id: string, message: string) =>
    api(`/status/${id}/reply`, { method: "POST", body: { message } }),
  highlight: (id: string) =>
    api(`/status/${id}/highlight`, { method: "POST" }),
};

export const callsApi = {
  start: (chatId: string, callType: "audio" | "video") =>
    api<Call>("/calls", {
      method: "POST",
      body: { chatId, callType },
    }),
  join: (id: string) =>
    api<{ livekitUrl: string; token: string; room: string; callId: string }>(
      `/calls/${id}/join`,
      { method: "POST" },
    ),
  leave: (id: string) => api(`/calls/${id}/leave`, { method: "POST" }),
  screenShare: (id: string, sharing: boolean) =>
    api(`/calls/${id}/screen-share?sharing=${sharing}`, { method: "POST" }),
  get: (id: string) => api(`/calls/${id}`),
  history: (chatId: string) =>
    api(`/calls/history?chat_id=${chatId}`),
};

export const vaultApi = {
  create: (body: {
    filename: string;
    sizeBytes: number;
    mimeType: string;
    checksumSha256: string;
    receiverId?: string;
    chatId?: string;
    downloadLimit?: number;
    expiresHours?: number;
  }) =>
    api<VaultTransfer>("/vault", {
      method: "POST",
      body,
    }),
  uploadChunk: (id: string, chunkIndex: number, file: Blob) => {
    const fd = new FormData();
    fd.append("file", file);
    return api(`/vault/${id}/chunks/${chunkIndex}`, {
      method: "PUT",
      formData: fd,
    });
  },
  get: (id: string) => api<VaultTransfer>(`/vault/${id}`),
  downloadUrl: (id: string) => `${API_BASE}/vault/${id}/download`,
};

export const mediaApi = {
  upload: async (file: File, purpose = "status") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("purpose", purpose);
    return api<{
      storage_key: string;
      url: string;
      mime_type: string;
      size_bytes: number;
      kind: "image" | "video";
      filename?: string;
    }>("/media/upload", { method: "POST", formData: fd });
  },
  url: (storageKey: string | null | undefined) => {
    if (!storageKey) return null;
    if (storageKey.startsWith("http")) return storageKey;
    const path = storageKey.startsWith("/")
      ? storageKey
      : `/media/${storageKey}`;
    return `${API_BASE}${path}`;
  },
};

type AiStreamHandlers = {
  onMeta?: (conversationId: string) => void;
  onToken?: (text: string) => void;
  onDone?: (conversationId?: string) => void;
  onError?: (message: string) => void;
};

/** Stream TALK-CONNECT AI via SSE. Never calls Gemini from the browser. */
export async function streamAiChat(
  body: { message: string; conversationId?: string },
  handlers: AiStreamHandlers,
): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify({
      message: body.message,
      conversationId: body.conversationId,
    }),
  });

  if (!res.ok) {
    let message = `AI request failed (${res.status})`;
    try {
      const data = await res.json();
      message = formatApiDetail(data, res.status);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw) continue;
      try {
        const event = JSON.parse(raw) as {
          type: string;
          conversationId?: string;
          text?: string;
          message?: string;
        };
        if (event.type === "meta" && event.conversationId) {
          handlers.onMeta?.(event.conversationId);
        } else if (event.type === "token" && event.text) {
          handlers.onToken?.(event.text);
        } else if (event.type === "done") {
          handlers.onDone?.(event.conversationId);
        } else if (event.type === "error") {
          handlers.onError?.(event.message ?? "AI error");
        }
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}
