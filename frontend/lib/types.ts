export type PresenceState =
  | "online"
  | "offline"
  | "on_call"
  | "screen_sharing";

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "voice"
  | "file"
  | "code"
  | "system"
  | "location";

export interface LocationShare {
  id: string;
  message_id: string;
  chat_id: string;
  sender_id: string;
  mode: "static" | "live";
  status: "active" | "stopped" | "expired";
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  expires_at?: string | null;
  stopped_early?: boolean;
  started_at?: string | null;
  last_updated_at?: string | null;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  display_name: string;
  bio?: string | null;
  status_text?: string | null;
  avatar_type?: "photo" | "icon";
  avatar_url?: string | null;
  avatar_icon_id?: string | null;
  avatar_video_url?: string | null;
  cover_photo_url?: string | null;
  is_verified?: boolean;
  presence_state?: PresenceState;
  online?: boolean;
  last_seen_at?: string | null;
  last_seen_visibility?: "everyone" | "friends" | "nobody";
  read_receipts_enabled?: boolean;
  typing_indicators_enabled?: boolean;
  phone_visibility?: string;
  findable_by_phone?: boolean;
  focus_until?: string | null;
  focus_message?: string | null;
  totp_enabled?: boolean;
  is_friend?: boolean;
}

export interface Attachment {
  id?: string;
  storage_key?: string;
  storageKey?: string;
  mime_type?: string;
  mimeType?: string;
  size_bytes?: number;
  sizeBytes?: number;
  filename?: string;
  url?: string;
}

export interface Reaction {
  user_id: string;
  emoji: string;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  type: MessageType;
  body?: string | null;
  reply_to_id?: string | null;
  forwarded_from_id?: string | null;
  code_language?: string | null;
  transcript?: string | null;
  view_once?: boolean;
  context?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  expires_at?: string | null;
  created_at: string;
  attachments?: Attachment[];
  reactions?: Reaction[];
  status?: string;
  /** Client-only optimistic delivery state */
  localStatus?: "pending" | "sent" | "failed";
  clientId?: string;
  location_share?: LocationShare | null;
}

export interface ChatMember {
  user_id: string;
  role: "owner" | "admin" | "member";
  muted?: boolean;
  pinned?: boolean;
  archived?: boolean;
  custom_tag?: string | null;
  user?: User;
}

export interface Chat {
  id: string;
  is_group: boolean;
  is_community?: boolean;
  is_notes_to_self?: boolean;
  name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  theme?: string | null;
  wallpaper?: string | null;
  disappear_after_seconds?: number | null;
  expires_at?: string | null;
  e2e_enabled?: boolean;
  created_by?: string;
  members?: ChatMember[];
  pinned?: boolean;
  muted?: boolean;
  unread_count?: number;
  auto_translate_language?: string | null;
  last_message?: Message | null;
  peer?: User | null;
}

export interface StatusPost {
  id: string;
  user_id: string;
  type: "image" | "video" | "text";
  caption?: string | null;
  background_style?: string | null;
  privacy?: string;
  storage_key?: string | null;
  expires_at?: string;
  is_highlighted?: boolean;
  has_unseen?: boolean;
  user?: User;
  reactions?: Reaction[];
  reaction_counts?: Record<string, number>;
}

export interface StatusFeedItem {
  user: User;
  statuses: StatusPost[];
  has_unseen: boolean;
}

export interface FriendRequest {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
  created_at: string;
  from_user?: User;
  to_user?: User;
}

export interface Call {
  id: string;
  chat_id: string;
  call_type: "audio" | "video";
  status: string;
  from_user_id?: string;
  livekit_room?: string;
}

export interface VaultTransfer {
  id: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  chunk_size: number;
  total_chunks: number;
  uploaded_chunks?: number[];
  status: "pending" | "uploading" | "complete" | "failed" | "expired";
  download_limit?: number;
  expires_hours?: number;
  expires_at?: string;
}

export interface AuthTokens {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export type WsClientMessage =
  | { type: "ping" }
  | { type: "typing"; data: { chatId: string; isTyping: boolean } }
  | {
      type: "call.offer" | "call.answer" | "call.ice" | "call.hangup";
      data: Record<string, unknown>;
    };

export type WsServerEvent = {
  type: string;
  data: Record<string, unknown>;
};
