/**
 * Normalize API / WS payloads to the snake_case shapes the UI expects.
 * Accepts either snake_case or camelCase so mixed backends stay safe.
 */

function pick<T = unknown>(
  obj: Record<string, unknown>,
  snake: string,
  camel: string,
): T | undefined {
  if (snake in obj && obj[snake] !== undefined) return obj[snake] as T;
  if (camel in obj && obj[camel] !== undefined) return obj[camel] as T;
  return undefined;
}

export function normalizeMessage(raw: unknown): import("./types").Message {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rawAttachments = pick<unknown>(o, "attachments", "attachments");
  const attachments = (Array.isArray(rawAttachments) ? rawAttachments : []).map(
    (a) => {
      const att = (a ?? {}) as Record<string, unknown>;
      return {
        id: att.id as string | undefined,
        storage_key: pick<string>(att, "storage_key", "storageKey"),
        mime_type: pick<string>(att, "mime_type", "mimeType"),
        size_bytes: pick<number>(att, "size_bytes", "sizeBytes"),
        filename: att.filename as string | undefined,
        url: att.url as string | undefined,
      };
    },
  );
  const rawReactions = pick<unknown>(o, "reactions", "reactions");
  const reactions = (Array.isArray(rawReactions) ? rawReactions : []).map(
    (r) => {
      const rx = (r ?? {}) as Record<string, unknown>;
      return {
        user_id: String(pick(rx, "user_id", "userId") ?? ""),
        emoji: String(rx.emoji ?? ""),
      };
    },
  );

  return {
    id: String(o.id ?? ""),
    chat_id: String(pick(o, "chat_id", "chatId") ?? ""),
    sender_id: String(pick(o, "sender_id", "senderId") ?? ""),
    type: (pick(o, "type", "type") as import("./types").MessageType) ?? "text",
    body: (pick(o, "body", "body") as string | null) ?? null,
    reply_to_id: (pick(o, "reply_to_id", "replyToId") as string | null) ?? null,
    forwarded_from_id:
      (pick(o, "forwarded_from_id", "forwardedFromId") as string | null) ?? null,
    code_language:
      (pick(o, "code_language", "codeLanguage") as string | null) ?? null,
    transcript: (pick(o, "transcript", "transcript") as string | null) ?? null,
    view_once: Boolean(pick(o, "view_once", "viewOnce") ?? false),
    context: (pick(o, "context", "context") as string | null) ?? null,
    edited_at: (pick(o, "edited_at", "editedAt") as string | null) ?? null,
    deleted_at: (pick(o, "deleted_at", "deletedAt") as string | null) ?? null,
    expires_at: (pick(o, "expires_at", "expiresAt") as string | null) ?? null,
    created_at: String(pick(o, "created_at", "createdAt") ?? new Date().toISOString()),
    attachments,
    reactions,
    status: o.status as string | undefined,
    clientId: o.clientId as string | undefined,
    localStatus: o.localStatus as import("./types").Message["localStatus"],
    location_share: normalizeLocationShare(
      pick(o, "location_share", "locationShare"),
    ),
  };
}

export function normalizeLocationShare(
  raw: unknown,
): import("./types").LocationShare | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  return {
    id: String(s.id ?? ""),
    message_id: String(pick(s, "message_id", "messageId") ?? ""),
    chat_id: String(pick(s, "chat_id", "chatId") ?? ""),
    sender_id: String(pick(s, "sender_id", "senderId") ?? ""),
    mode: (pick(s, "mode", "mode") as "static" | "live") ?? "static",
    status:
      (pick(s, "status", "status") as "active" | "stopped" | "expired") ??
      "active",
    latitude: Number(s.latitude ?? 0),
    longitude: Number(s.longitude ?? 0),
    accuracy_meters:
      (pick(s, "accuracy_meters", "accuracyMeters") as number | null) ?? null,
    expires_at:
      (pick(s, "expires_at", "expiresAt") as string | null) ?? null,
    stopped_early: Boolean(pick(s, "stopped_early", "stoppedEarly")),
    started_at:
      (pick(s, "started_at", "startedAt") as string | null) ?? null,
    last_updated_at:
      (pick(s, "last_updated_at", "lastUpdatedAt") as string | null) ?? null,
  };
}

export function normalizeChat(raw: unknown): import("./types").Chat {
  const o = (raw ?? {}) as Record<string, unknown>;
  const peerRaw = o.peer as Record<string, unknown> | null | undefined;
  const lastRaw = pick(o, "last_message", "lastMessage");

  return {
    id: String(o.id ?? ""),
    is_group: Boolean(pick(o, "is_group", "isGroup")),
    is_community: Boolean(pick(o, "is_community", "isCommunity")),
    is_notes_to_self: Boolean(pick(o, "is_notes_to_self", "isNotesToSelf")),
    name: (pick(o, "name", "name") as string | null) ?? null,
    description: (pick(o, "description", "description") as string | null) ?? null,
    avatar_url: (pick(o, "avatar_url", "avatarUrl") as string | null) ?? null,
    theme: (pick(o, "theme", "theme") as string | null) ?? null,
    wallpaper: (pick(o, "wallpaper", "wallpaper") as string | null) ?? null,
    disappear_after_seconds:
      (pick(o, "disappear_after_seconds", "disappearAfterSeconds") as
        | number
        | null) ?? null,
    expires_at: (pick(o, "expires_at", "expiresAt") as string | null) ?? null,
    e2e_enabled: Boolean(pick(o, "e2e_enabled", "e2eEnabled")),
    created_by: pick(o, "created_by", "createdBy") as string | undefined,
    pinned: Boolean(o.pinned),
    muted: Boolean(o.muted),
    unread_count: Number(pick(o, "unread_count", "unreadCount") ?? 0),
    auto_translate_language:
      (pick(o, "auto_translate_language", "autoTranslateLanguage") as
        | string
        | null) ?? null,
    last_message: lastRaw ? normalizeMessage(lastRaw) : null,
    peer: peerRaw
      ? {
          id: String(peerRaw.id ?? ""),
          username: String(peerRaw.username ?? ""),
          display_name: String(
            pick(peerRaw, "display_name", "displayName") ?? "",
          ),
          avatar_url:
            (pick(peerRaw, "avatar_url", "avatarUrl") as string | null) ?? null,
          avatar_icon_id:
            (pick(peerRaw, "avatar_icon_id", "avatarIconId") as
              | string
              | null) ?? null,
          avatar_type: pick(peerRaw, "avatar_type", "avatarType") as
            | "photo"
            | "icon"
            | undefined,
          presence_state: pick(
            peerRaw,
            "presence_state",
            "presenceState",
          ) as import("./types").PresenceState | undefined,
          status_text:
            (pick(peerRaw, "status_text", "statusText") as string | null) ??
            null,
          focus_until:
            (pick(peerRaw, "focus_until", "focusUntil") as string | null) ??
            null,
          focus_message:
            (pick(peerRaw, "focus_message", "focusMessage") as
              | string
              | null) ?? null,
        }
      : null,
  };
}

export function normalizeStatusFeedItem(
  raw: unknown,
): import("./types").StatusFeedItem {
  const o = (raw ?? {}) as Record<string, unknown>;

  // Already FE-shaped
  if (o.user && (o.statuses || o.posts)) {
    const user = o.user as Record<string, unknown>;
    const posts = (o.statuses ?? o.posts ?? []) as unknown[];
    return {
      user: {
        id: String(user.id ?? o.user_id ?? ""),
        username: String(user.username ?? ""),
        display_name: String(
          pick(user, "display_name", "displayName") ?? "",
        ),
        avatar_url:
          (pick(user, "avatar_url", "avatarUrl") as string | null) ?? null,
        avatar_icon_id:
          (pick(user, "avatar_icon_id", "avatarIconId") as string | null) ??
          null,
      },
      statuses: posts.map(normalizeStatusPost),
      has_unseen: Boolean(pick(o, "has_unseen", "hasUnseen")),
    };
  }

  // Legacy BE shape: flat user fields + posts
  return {
    user: {
      id: String(pick(o, "user_id", "userId") ?? ""),
      username: String(o.username ?? ""),
      display_name: String(pick(o, "display_name", "displayName") ?? ""),
      avatar_url: (pick(o, "avatar_url", "avatarUrl") as string | null) ?? null,
      avatar_icon_id:
        (pick(o, "avatar_icon_id", "avatarIconId") as string | null) ?? null,
    },
    statuses: ((o.posts ?? o.statuses ?? []) as unknown[]).map(
      normalizeStatusPost,
    ),
    has_unseen: Boolean(pick(o, "has_unseen", "hasUnseen")),
  };
}

function normalizeStatusPost(raw: unknown): import("./types").StatusPost {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(o.id ?? ""),
    user_id: String(pick(o, "user_id", "userId") ?? ""),
    type: (o.type as import("./types").StatusPost["type"]) ?? "text",
    caption: (o.caption as string | null) ?? null,
    background_style:
      (pick(o, "background_style", "backgroundStyle") as string | null) ?? null,
    privacy: o.privacy as string | undefined,
    storage_key:
      (pick(o, "storage_key", "storageKey") as string | null) ?? null,
    expires_at: String(pick(o, "expires_at", "expiresAt") ?? ""),
    is_highlighted: Boolean(pick(o, "is_highlighted", "isHighlighted")),
  };
}
