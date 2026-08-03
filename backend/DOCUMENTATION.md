# TALK CONNECT — Backend Documentation

Complete reference for the TALK CONNECT FastAPI backend: architecture, configuration, data model, REST API, WebSocket contract, and feature notes.

Interactive OpenAPI UI is always available at `/docs` when the server is running.

---

## Table of contents

1. [Overview](#1-overview)
2. [Getting started](#2-getting-started)
3. [Architecture](#3-architecture)
4. [Configuration](#4-configuration)
5. [Authentication & authorization](#5-authentication--authorization)
6. [REST API reference](#6-rest-api-reference)
7. [WebSocket realtime](#7-websocket-realtime)
8. [Data model](#8-data-model)
9. [Feature guides](#9-feature-guides)
10. [Error handling](#10-error-handling)
11. [Local development tips](#11-local-development-tips)

---

## 1. Overview

TALK CONNECT is a messenger backend with:

| Area | Capabilities |
|---|---|
| Auth | Register, verify, login, JWT + refresh rotation, 2FA (TOTP), password reset, logout-all |
| Users | Profiles, search, photo/icon avatars, cover photo, Focus Sync, GDPR export/delete |
| Friends | Requests, accept/decline, block, hashed contact sync |
| Status | 24h stories, privacy, views, public reactions, highlights |
| Chats | 1:1 DMs, groups, Notes to Self, themes, disappearing messages, time-boxed chats, E2E flag |
| Messages | Text/media/voice/code, reply, edit, delete, forward, search, reactions, read receipts |
| Calls | LiveKit-ready voice/video (stub tokens in local/dev) |
| Vault | Chunked, resumable large-file transfer with checksum + download limits |
| Realtime | Multiplexed WebSocket: messages, typing, presence, calls, friends, status |

---

## 2. Getting started

### Requirements

- Python **≥ 3.14**
- [uv](https://docs.astral.sh/uv/)
- Optional: Redis (falls back to in-memory if unavailable)

### Install & run

```powershell
cd D:\chat-app\backend
uv sync
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Or via the package script:

```powershell
uv run backend
```

### First request smoke test

```powershell
# Health
Invoke-RestMethod http://127.0.0.1:8000/health

# Register → verify → login
$reg = Invoke-RestMethod -Method POST http://127.0.0.1:8000/auth/register `
  -ContentType application/json `
  -Body '{"username":"alice","email":"alice@example.com","password":"password123","display_name":"Alice"}'
Invoke-RestMethod -Method POST http://127.0.0.1:8000/auth/verify `
  -ContentType application/json `
  -Body (@{email="alice@example.com"; code=$reg.verification_code} | ConvertTo-Json)
$login = Invoke-RestMethod -Method POST http://127.0.0.1:8000/auth/login `
  -ContentType application/json `
  -Body '{"email":"alice@example.com","password":"password123","device_name":"Chrome"}'
# Use: Authorization: Bearer $($login.access_token)
```

---

## 3. Architecture

```
Client
  │  REST (Bearer JWT)
  │  WS   /ws?token=<access>
  ▼
FastAPI (uvicorn)
  ├── api/          route handlers
  ├── services/     business logic + WS publish
  ├── models/       SQLAlchemy ORM
  ├── schemas/      Pydantic I/O
  └── core/         config, DB, security, deps, Redis
        │
        ├── SQLite / Postgres (Neon)
        └── Redis (or MemoryRedis fallback)
```

### Package map

| Path | Role |
|---|---|
| `src/backend/main.py` | App factory, CORS, lifespan (DB init, Redis, icon seed, status expiry loop) |
| `src/backend/api/` | Routers: auth, users, friends, status, chats, messages, calls_vault, ws |
| `src/backend/core/config.py` | Settings from env / `.env` |
| `src/backend/core/database.py` | Async engine, sessions, schema create + SQLite column patches |
| `src/backend/core/security.py` | bcrypt, JWT access/refresh, token hashing |
| `src/backend/core/deps.py` | `get_current_user`, chat/status authorization dependencies |
| `src/backend/core/redis_client.py` | Redis client + in-memory fallback, rate limits |
| `src/backend/services/` | Domain services (auth, chat, message, call, vault, …) |
| `src/backend/models/` | ORM tables |
| `src/backend/schemas/` | Request/response models |

### Design rules

- **Authentication** answers “who is this?” (`get_current_user`).
- **Authorization** answers “are they allowed?” (`require_chat_member`, `require_chat_admin`, `require_status_visible`, …).
- Failures: **401** = invalid/missing identity; **403** = identity known but action denied.
- Realtime events are published via `services.realtime.manager` (Redis pub/sub + local fan-out). Services never talk to sockets directly beyond the manager.

---

## 4. Configuration

Loaded from environment / `.env` via `pydantic-settings`.

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `dev-secret-…` | JWT signing key — **change in production** |
| `DATABASE_URL` | `sqlite+aiosqlite:///./talkconnect.db` | Async SQLAlchemy URL. For Neon: `postgresql+asyncpg://…?ssl=require` |
| `REDIS_URL` | `redis://localhost:6379/0` | Presence + pub/sub; memory fallback if unreachable |
| `DEBUG` | `true` | SQL echo / cookie `Secure` flag behavior |
| `ACCESS_TOKEN_MINUTES` | `15` | Access JWT lifetime |
| `REFRESH_TOKEN_DAYS` | `30` | Refresh cookie lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hash cost |
| `LOGIN_MAX_ATTEMPTS` | `5` | Rate limit per IP and per account |
| `LOGIN_WINDOW_SECONDS` | `300` | Rate-limit window |
| `INSTANCE_ID` | `local-1` | Socket registration prefix for multi-instance |
| `CORS_ORIGINS` | localhost:3000, :5173 | Allowed browser origins |
| `LIVEKIT_URL` | _(empty)_ | LiveKit WS URL; stub tokens if unset |
| `LIVEKIT_API_KEY` | _(empty)_ | LiveKit API key |
| `LIVEKIT_API_SECRET` | _(empty)_ | LiveKit API secret |
| `MAX_ATTACHMENT_BYTES` | `104857600` (100MB) | Normal attachment ceiling |
| `VAULT_CHUNK_SIZE` | `5242880` (5MB) | Vault chunk size |
| `VAULT_MAX_BYTES` | `10737418240` (10GB) | Vault max file size |

> Setting field names in code use snake_case (`database_url`, `secret_key`). Env vars may be uppercase (`DATABASE_URL`, `SECRET_KEY`).

### Neon / Postgres notes

- Use the **pooled** (`-pooler`) connection string for the app.
- Use a **direct** (non-pooled) URL for migrations/DDL if you add Alembic later.
- `pool_pre_ping=True` is enabled automatically for Postgres URLs.

---

## 5. Authentication & authorization

### Tokens

| Token | Lifetime | Storage | Purpose |
|---|---|---|---|
| Access JWT | 15 min | `Authorization: Bearer …` only | Every REST call + WS connect |
| Refresh JWT | 30 days, rotated | httpOnly, Secure (prod), SameSite=Strict cookie (`path=/auth`) | Mint new access tokens |

JWT payload (minimal): `{ sub, iat, exp, jti, type }`. Roles/permissions are **not** embedded — looked up from the DB.

### Auth endpoints summary

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | No | Creates user; returns `verification_code` in **dev** |
| POST | `/auth/verify` | No | Sets `is_verified=true` |
| POST | `/auth/login` | No | Issues tokens; only mint point |
| POST | `/auth/refresh` | Cookie | Rotates refresh + new access |
| POST | `/auth/logout` | Bearer | Revokes current device refresh |
| POST | `/auth/logout-all` | Bearer | Revokes all devices |
| POST | `/auth/forgot-password` | No | Returns `reset_token` in **dev** |
| POST | `/auth/reset-password` | No | New password; revokes all refresh tokens |
| GET | `/auth/me` | Bearer | Own profile |
| POST | `/auth/2fa/setup` | Bearer | Returns TOTP secret + provisioning URI |
| POST | `/auth/2fa/confirm` | Bearer | Enables 2FA |
| POST | `/auth/2fa/disable` | Bearer | Needs password + TOTP code |

### Login body

```json
{
  "email": "alice@example.com",
  "password": "password123",
  "device_name": "Chrome on Windows",
  "totp_code": "123456"
}
```

`totp_code` is required only after 2FA is enabled. New-device logins are logged as a security signal.

### Authorization helpers (`core/deps.py`)

| Dependency | Returns | Rule |
|---|---|---|
| `get_current_user` | `User` | Valid access JWT |
| `require_chat_member` | `ChatMember` | User is in chat |
| `require_chat_admin` | `ChatMember` | Role `admin` or `owner` |
| `require_chat_owner` | `ChatMember` | Role `owner` |
| `require_message_access` | `Message` | Member of message’s chat |
| `require_status_visible` | `StatusPost` | Friend/privacy rules |

---

## 6. REST API reference

All protected routes need:

```
Authorization: Bearer <access_token>
```

CamelCase aliases are accepted on many write bodies (e.g. `toUserId`, `memberUserIds`, `chatId`).

---

### 6.1 Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | `{ "status": "ok", "app": "TALK CONNECT" }` |

---

### 6.2 Auth — `/auth`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/register` | `{ username, email, password, display_name, phone? }` | `{ message, user_id, verification_code }` |
| POST | `/verify` | `{ email, code }` | `{ message }` |
| POST | `/login` | `{ email, password, device_name?, totp_code? }` | `{ access_token, token_type, expires_in }` + refresh cookie |
| POST | `/refresh` | _(cookie)_ | New access + rotated cookie |
| POST | `/logout` | — | Clears cookie, revokes device |
| POST | `/logout-all` | — | Revokes all devices |
| POST | `/forgot-password` | `{ email }` | `{ message, reset_token? }` |
| POST | `/reset-password` | `{ token, new_password }` | `{ message }` |
| GET | `/me` | — | `UserOut` |
| POST | `/2fa/setup` | — | `{ secret, provisioning_uri }` |
| POST | `/2fa/confirm` | `{ code }` | `{ message }` |
| POST | `/2fa/disable` | `{ code, password }` | `{ message }` |

---

### 6.3 Users — `/users`

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/search?q=` | query | Search by username / phone / display name |
| GET | `/{user_id}` | — | Public profile (privacy-filtered) |
| PATCH | `/me` | profile fields | Update display name, bio, status_text, privacy toggles |
| POST | `/me/avatar` | `{ avatar_url?, avatar_video_url? }` | Photo / video avatar |
| POST | `/me/avatar/icon` | `{ avatarIconId }` | Preset icon avatar |
| GET | `/avatar-icons` | — | List preset icons |
| POST | `/me/cover-photo` | `{ cover_photo_url }` | Cover banner |
| POST | `/me/focus` | `{ until?, message?, shareWith[] }` | Focus Sync busy status |
| DELETE | `/me/focus` | — | Clear focus |
| POST | `/me/export` | — | GDPR-style data export JSON |
| DELETE | `/me` | — | Delete account + related data |

**PATCH `/users/me` fields:** `display_name`, `bio`, `status_text`, `last_seen_visibility` (`everyone`\|`friends`\|`nobody`), `read_receipts_enabled`, `typing_indicators_enabled`, `phone_visibility`, `findable_by_phone`.

---

### 6.4 Friends & contacts

| Method | Path | Body / Query | Description |
|---|---|---|---|
| POST | `/friends/requests` | `{ toUserId }` | Send request |
| GET | `/friends/requests?direction=incoming\|outgoing` | — | Pending list |
| POST | `/friends/requests/{id}/accept` | — | Accept → creates `Friendship` |
| POST | `/friends/requests/{id}/decline` | — | Decline |
| DELETE | `/friends/requests/{id}` | — | Cancel outgoing |
| GET | `/friends` | — | Friends + online / last_seen |
| DELETE | `/friends/{user_id}` | — | Unfriend |
| POST | `/friends/{user_id}/block` | — | Block (+ removes friendship) |
| DELETE | `/friends/{user_id}/block` | — | Unblock |
| POST | `/contacts/sync` | `{ phone_hashes[] }` | Match hashed phone numbers |

1:1 chats and Status visibility require an accepted friendship (unless blocked).

---

### 6.5 Status / Stories — `/status`

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/status` | create body | Image / video / text status (24h) |
| GET | `/status/feed` | — | Friends’ active status, unseen-first |
| GET | `/status/{id}` | — | Single status (if visible) |
| DELETE | `/status/{id}` | — | Delete own |
| POST | `/status/{id}/view` | — | Record view (idempotent) |
| GET | `/status/{id}/views` | — | Poster-only viewer list |
| POST | `/status/{id}/react` | `{ emoji }` | Public reaction |
| DELETE | `/status/{id}/react` | — | Remove reaction |
| GET | `/status/{id}/reactions` | — | List reactions |
| POST | `/status/{id}/reply` | `{ message }` | Private reply event |
| POST | `/status/{id}/highlight` | — | Pin past 24h expiry |

**Create body:**

```json
{
  "type": "text",
  "caption": "Hello",
  "background_style": "aurora",
  "privacy": "friends",
  "audience_ids": null,
  "storage_key": null
}
```

`privacy`: `friends` | `close_friends` | `only_share_with` | `except`  
Media types require `storage_key`. A background sweep soft-deletes expired (non-highlighted) posts every ~3 minutes.

---

### 6.6 Chats — `/chats`

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/chats` | — | My chats (pinned first) |
| POST | `/chats/direct` | `{ userId }` | Get-or-create 1:1 (friends only) |
| POST | `/chats/groups` | `{ name, memberUserIds[] }` | Create group; you are `owner` |
| GET | `/chats/notes-to-self` | — | Personal Notes to Self chat |
| GET | `/chats/{id}` | — | Chat detail |
| PATCH | `/chats/{id}` | update body | Theme, disappear timer, E2E, rename (admin for groups) |
| POST | `/chats/{id}/members` | `{ userIds[] }` | Add friends (admin+) |
| DELETE | `/chats/{id}/members/{user_id}` | — | Remove / kick |
| POST | `/chats/{id}/members/{user_id}/promote` | — | Owner → grant admin |
| POST | `/chats/{id}/members/{user_id}/demote` | — | Owner → revoke admin |
| POST | `/chats/{id}/leave` | — | Leave; owner transfers to next admin/member |

**PATCH body (aliases supported):**

```json
{
  "name": "Dev Room",
  "avatarUrl": null,
  "theme": "aurora",
  "wallpaper": "grid",
  "disappearAfterSeconds": 3600,
  "expiresInHours": 48,
  "e2eEnabled": false
}
```

- `disappearAfterSeconds` — default TTL applied to new messages in the chat  
- `expiresInHours` — **time-boxed chat**: whole conversation hidden after deadline  
- `e2eEnabled` — per-chat E2E opt-in flag (client/crypto layer TBD)

**Roles:** `owner` | `admin` | `member`

---

### 6.7 Messages

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/chats/{chat_id}/messages?limit=&before=` | — | Paginated history (newest page) |
| POST | `/chats/{chat_id}/messages` | message body | Send |
| GET | `/chats/{chat_id}/messages/search?q=` | — | Full-text-ish search (`ILIKE`) |
| PATCH | `/messages/{id}` | `{ body }` | Edit own text/code (sets `editedAt`) |
| DELETE | `/messages/{id}` | — | Soft-delete (sender or chat admin) |
| POST | `/messages/{id}/forward` | `{ targetChatId }` | Forward into another chat |
| POST | `/messages/{id}/read` | — | Mark read (respects read-receipts toggle) |
| POST | `/messages/{id}/react` | `{ emoji }` | Reaction |
| DELETE | `/messages/{id}/react` | — | Remove reaction |

**Send body:**

```json
{
  "body": "hello",
  "type": "text",
  "replyToId": null,
  "codeLanguage": null,
  "transcript": null,
  "viewOnce": false,
  "context": null,
  "attachments": [
    {
      "storageKey": "uploads/…",
      "mimeType": "image/jpeg",
      "sizeBytes": 12345,
      "filename": "pic.jpg"
    }
  ]
}
```

**Message types:** `text` | `image` | `video` | `voice` | `file` | `code` | `system`

**Code Rooms:** `type: "code"` + `codeLanguage` (e.g. `"python"`).

Realtime: `message.new`, `message.ack`, `message.read`, `message.reaction`, `message.edited`, `message.deleted`.

---

### 6.8 Calls — `/calls`

| Method | Path | Body / Query | Description |
|---|---|---|---|
| POST | `/calls` | `{ chatId, callType }` | Start call (`audio`\|`video`); WS `call.incoming` |
| POST | `/calls/{id}/join` | — | `{ livekitUrl, token, room, callId }` |
| POST | `/calls/{id}/leave` | — | Leave; ends call when empty |
| POST | `/calls/{id}/screen-share?sharing=` | — | Adaptive presence → `screen_sharing` |
| GET | `/calls/{id}` | — | Status |
| GET | `/calls/history?chat_id=` | — | Call history for a chat |

Without LiveKit credentials, join returns a **dev stub token** (`dev-livekit-token:…`). Set `LIVEKIT_*` for real SFU tokens.

Presence while in a call: `on_call` / `screen_sharing`.

---

### 6.9 Vault — `/vault`

Chunked, resumable large-file transfer (developer-oriented differentiator).

| Method | Path | Description |
|---|---|---|
| POST | `/vault` | Create transfer metadata → returns chunk plan |
| PUT | `/vault/{id}/chunks/{chunk_index}` | Upload one chunk (`multipart` field `file`) |
| GET | `/vault/{id}` | Progress / status |
| GET | `/vault/{id}/download` | Download assembled file (authz + limits) |

**Create body:**

```json
{
  "filename": "dataset.zip",
  "sizeBytes": 104857600,
  "mimeType": "application/zip",
  "checksumSha256": "…",
  "receiverId": "<user_id>",
  "chatId": null,
  "downloadLimit": 5,
  "expiresHours": 72
}
```

**Statuses:** `pending` → `uploading` → `complete` (or `failed` / `expired`).

Files land under `vault_storage/` (git-ignored). Download allowed for sender, receiver, or members of `chatId` when set.

---

## 7. WebSocket realtime

### Connect

```
WS /ws?token=<access_token>
```

Invalid/expired token → close code **4401**.

### Client → server

| `type` | `data` | Behavior |
|---|---|---|
| `ping` | — | Refresh presence TTL; reply `pong` |
| `typing` | `{ chatId, isTyping }` | Fan-out typing indicator |
| `call.offer` / `call.answer` / `call.ice` / `call.hangup` | `{ toUserId, callId, … }` | Signaling relay to peer |

Example:

```json
{ "type": "ping" }
{ "type": "typing", "data": { "chatId": "…", "isTyping": true } }
```

### Server → client (catalogue)

**Messaging**

```json
{ "type": "typing", "data": { "chatId": "…", "userId": "…", "isTyping": true } }
{ "type": "message.new", "data": { /* Message */ } }
{ "type": "message.ack", "data": { "messageId": "…", "chatId": "…" } }
{ "type": "message.read", "data": { "messageId": "…", "userId": "…", "chatId": "…" } }
{ "type": "message.reaction", "data": { "messageId": "…", "userId": "…", "emoji": "❤️" } }
{ "type": "message.edited", "data": { /* Message */ } }
{ "type": "message.deleted", "data": { "messageId": "…", "chatId": "…" } }
```

**Presence (adaptive)**

```json
{ "type": "presence", "data": { "userId": "…", "online": true, "state": "online|on_call|screen_sharing|offline" } }
```

**Calls**

```json
{ "type": "call.incoming", "data": { "callId": "…", "fromUserId": "…", "callType": "video", "chatId": "…" } }
{ "type": "call.ended", "data": { "callId": "…", "reason": "hangup" } }
```

**Friends**

```json
{ "type": "friend.request", "data": { "requestId": "…", "fromUserId": "…" } }
{ "type": "friend.accepted", "data": { "userId": "…" } }
```

**Status**

```json
{ "type": "status.new", "data": { /* StatusPost */ } }
{ "type": "status.viewed", "data": { "statusId": "…", "userId": "…" } }
{ "type": "status.reaction", "data": { "statusId": "…", "userId": "…", "emoji": "🔥" } }
```

**Focus Sync**

```json
{ "type": "focus.updated", "data": { "userId": "…", "until": "…", "message": "busy until 3pm" } }
```

**Chats**

```json
{ "type": "chat.new", "data": { "chatId": "…", "name": "…", "isGroup": true } }
{ "type": "chat.added", "data": { "chatId": "…" } }
```

Recommended client heartbeat: send `ping` every ~25s.

---

## 8. Data model

### Core entities

```
User, Device, AvatarIcon
Friendship, FriendRequest, Block, ContactSync
Chat, ChatMember
Message, MessageStatus, Attachment
Reaction          (polymorphic: message | status)
StatusPost, StatusView, StatusReply
Call, CallParticipant
FileTransfer      (Vault)
```

### Key fields (abbreviated)

**User** — `username`, `email`, `password_hash`, `display_name`, `bio`, `status_text`, `avatar_type` (`photo`\|`icon`), `avatar_url`, `avatar_icon_id`, `is_verified`, `totp_secret`, `last_seen_*`, `read_receipts_enabled`, `typing_indicators_enabled`, `focus_until` / `focus_message` / `focus_share_with`, phone privacy fields.

**Chat** — `is_group`, `is_notes_to_self`, `name`, `theme`, `wallpaper`, `disappear_after_seconds`, `expires_at`, `e2e_enabled`, `created_by`.

**ChatMember** — `role` (`member`\|`admin`\|`owner`), `muted`, `pinned`, `archived`, `custom_tag`.

**Message** — `type`, `body`, `reply_to_id`, `forwarded_from_id`, `code_language`, `transcript`, `view_once`, `edited_at`, `deleted_at`, `expires_at`.

**StatusPost** — `type` (`image`\|`video`\|`text`), `privacy`, `audience_ids`, `expires_at`, `is_highlighted`.

**FileTransfer** — chunk plan, `checksum_sha256`, `status`, download limits, expiry.

**Call** — `call_type`, `status`, `livekit_room`, duration fields.

### Reactions

Single table, unique per `(target_type, target_id, user_id)` — one emoji per user per target; changing emoji updates the row.

---

## 9. Feature guides

### Focus Sync

Share a soft “busy until …” with selected contacts without hard DND.

```http
POST /users/me/focus
{ "until": "2026-08-01T22:00:00Z", "message": "busy until 3pm", "shareWith": ["<friend_id>"] }
```

Those friends see `focus` on the public profile and receive `focus.updated` over WS.

### Adaptive presence

Redis key `presence:{user_id}` holds: `online` | `offline` | `on_call` | `screen_sharing`.  
Exposed on friend list / public profile as `presence_state`.

### Notes to Self

`GET /chats/notes-to-self` returns (or creates) a private single-member chat.

### Code Rooms

Send a message with `type: "code"` and `codeLanguage`. Treated as a first-class message type for syntax-highlighted UI.

### Disappearing content

1. **Per-chat default:** `PATCH /chats/{id}` with `disappearAfterSeconds` → new messages get `expiresAt`.
2. **Time-boxed chat:** `expiresInHours` → chat disappears from lists after deadline.
3. **Status:** 24h expiry + highlight exemption + background sweep.

### Vault upload flow

1. `POST /vault` with total `sizeBytes` → get `id`, `chunkSize`, `totalChunks`
2. For `i` in `0 .. totalChunks-1`: `PUT /vault/{id}/chunks/{i}` with multipart `file`
3. When `status == complete`, peer uses `GET /vault/{id}/download`

### LiveKit

1. `POST /calls` in a chat  
2. Peers receive `call.incoming`  
3. Each peer `POST /calls/{id}/join` → connect client SDK to `livekitUrl` with `token`  
4. Media never flows through FastAPI

---

## 10. Error handling

| Status | Meaning | Client action |
|---|---|---|
| 401 | Missing/invalid/expired token or bad credentials | Re-login / refresh |
| 403 | Authenticated but not allowed | Show “not allowed” |
| 404 | Resource missing | — |
| 409 | Conflict (e.g. username taken) | — |
| 429 | Login rate limited | Back off |

Validation errors return FastAPI/Pydantic **422** with field details.

---

## 11. Local development tips

- **Swagger:** http://127.0.0.1:8000/docs — authorize with the access token from `/auth/login`.
- **DB file:** `talkconnect.db` in the project root (SQLite). Delete it to reset schema/data.
- **Redis optional:** if Redis isn’t running, the app uses an in-memory stand-in (single-process only).
- **Verification / reset codes** are returned in API responses in debug/dev for convenience — remove that for production and send email/SMS instead.
- **CORS** defaults allow Vite/Next local origins; set `CORS_ORIGINS` for deployed frontends.
- **Vault files** are stored under `vault_storage/`; both that folder and `.env` / `*.db` are git-ignored.

### Related design docs in this repo

| File | Scope |
|---|---|
| `BACKEND-AUTH-REALTIME-STATUS.md` | Auth, WS, friends, status deep dive |
| `BACKEND-FINAL.md` | Neon, groups, LiveKit consolidation |
| `RESEARCH-CHAT-APP-FEATURES.md` | Competitor research + build priority |

---

*Generated for the implemented FastAPI backend in `src/backend/`. Prefer `/docs` for live request schemas.*
