# TALK CONNECT — Backend v3: Auth, Realtime, Contacts & Status

**Scope of this doc:** Authentication & Authorization (deep dive) · WebSocket realtime layer for messages + calls · User profiles (photo/video) · Friends/Contacts system · Status/Stories (photo & video status, likes & reactions) · the checklist of "must-have" features every serious messenger needs.

This complements `BACKEND.md` (which covers chats, messages, calls, Vault large-file transfer, notifications). Read that first for the base project structure — this doc adds the pieces that weren't detailed yet: **contacts** and **status**, plus a much deeper look at auth/authorization and the realtime socket layer.

---

## 1. Authentication — Full Detail

Authentication answers **"who is this request from?"**. Nothing else — it never decides what they're allowed to do.

### 1.1 Token model
| Token | Lifetime | Storage | Purpose |
|---|---|---|---|
| **Access token (JWT)** | 15 minutes | Memory / Authorization header only, never localStorage | Sent on every REST call & WS connect, decoded on every request |
| **Refresh token** | 30 days, rotated on every use | httpOnly, Secure, SameSite=Strict cookie | Used only to mint a new access token |

JWT payload: `{ sub: user_id, iat, exp, jti }` — kept minimal, never carries roles/permissions (those are looked up fresh from the DB, so a revoked permission takes effect immediately instead of waiting for token expiry).

### 1.2 Endpoints

| Method | Path | Behavior |
|---|---|---|
| POST | `/auth/register` | Validate → hash password (bcrypt, cost 12) → create `User` → send verification email/OTP → **no tokens issued yet** |
| POST | `/auth/verify` | Confirm email/phone OTP → marks `User.is_verified = true` |
| POST | `/auth/login` | Verify password → issue access + refresh token → upsert `Device` row → **this is the only place tokens are minted** |
| POST | `/auth/refresh` | Validate refresh cookie against stored hash → rotate (invalidate old `jti`, issue new pair) |
| POST | `/auth/logout` | Revoke current refresh token, remove `Device`, close any live WS session for that device |
| POST | `/auth/logout-all` | Revoke **all** refresh tokens for the user — "log out of all devices" security action |
| POST | `/auth/forgot-password` | Send reset link/OTP, single-use, 15-min expiry |
| POST | `/auth/reset-password` | Consume reset token → hash new password → **revoke all existing refresh tokens** (force re-login everywhere) |
| GET | `/auth/me` | Return the authenticated user's own profile |

### 1.3 Password & account safety
- bcrypt hashing only, never reversible encryption.
- Login rate-limited per IP **and** per account (e.g. 5 attempts / 5 minutes, exponential backoff) via Redis counters — prevents brute force without a hard lockout that itself becomes a denial-of-service vector.
- Optional **2FA** (TOTP): `User.totp_secret` (nullable), enforced at login as a second step before tokens are issued.
- New-device login triggers an email notification ("New login from Chrome on Windows, Lahore") — security signal, not chat noise, so it bypasses normal notification-muting rules.

---

## 2. Authorization — Full Detail

Authorization answers **"is this already-identified user allowed to do this specific thing?"**. It always runs *after* authentication, as a second, separate dependency — never merged into the same function.

### 2.1 Pattern
```python
# core/deps.py
async def get_current_user(token: str = Depends(oauth2_scheme), db=Depends(get_db)) -> User:
    payload = decode_access_token(token)          # raises 401 if invalid/expired
    user = await db.get(User, payload["sub"])
    if not user:
        raise HTTPException(401)
    return user

def require_chat_member(chat_id: UUID):
    async def _check(user: User = Depends(get_current_user), db=Depends(get_db)):
        member = await db.get(ChatMember, (chat_id, user.id))
        if not member:
            raise HTTPException(403, "Not a member of this chat")
        return member
    return _check

def require_chat_admin(chat_id: UUID):
    async def _check(member: ChatMember = Depends(require_chat_member(chat_id))):
        if member.role != "admin":
            raise HTTPException(403, "Admin role required")
        return member
    return _check

def require_message_owner(message_id: UUID):
    async def _check(user: User = Depends(get_current_user), db=Depends(get_db)):
        message = await db.get(Message, message_id)
        if not message or message.sender_id != user.id:
            raise HTTPException(403, "Not your message")
        return message
    return _check
```

Every mutating route composes these: `current_user: User = Depends(get_current_user)` for identity, plus whichever `require_*` fits the action, e.g.:
```python
@router.delete("/chats/{chat_id}/members/{user_id}")
async def remove_member(chat_id: UUID, user_id: UUID, _: ChatMember = Depends(require_chat_admin(chat_id))):
    ...
```

### 2.2 Authorization matrix (representative)

| Action | Rule |
|---|---|
| Read a chat's messages | Must be a `ChatMember` of that chat |
| Edit/delete a message | Must be the `sender_id` (or a chat admin, for moderation) |
| Rename group / change group photo | Must have `role = admin` in that `ChatMember` row |
| Add/remove a group member | Admin only |
| View someone's Status | Must be an accepted friend **and** not on that user's Status block-list |
| Like/react to a Status | Same visibility rule as viewing it |
| Join a call | Must be a `ChatMember` of the call's chat |
| Download a Vault file | Must be `sender_id`, `receiver_id`, or (for chat-attached transfers) a member of that chat, and the link must not be expired/exhausted |

Authorization failures always return `403` (identity known, action denied) — never `401` (which means identity itself is invalid). Keeping these distinct matters for client-side handling (401 → force re-login, 403 → show "not allowed" without touching the session).

---

## 3. WebSocket Realtime Layer — Messages + Calls

One authenticated, multiplexed connection per active session carries **everything** realtime: messages, typing, read receipts, presence, call signaling, status updates, and reaction events. This avoids juggling multiple sockets and lets a single Redis pub/sub layer fan every event out correctly across horizontally scaled API instances.

### 3.1 Connection lifecycle
```
WS /ws?token=<access_token>
```
1. On connect, the server decodes the JWT (authentication) — reject with close code `4401` if invalid/expired.
2. Server registers the connection in Redis: `SADD sockets:{user_id} {instance_id}:{connection_id}` and `SETEX presence:{user_id} 60 online`.
3. Server subscribes this connection to Redis pub/sub channels for: every chat the user is a member of, the user's own notification channel, and a global `presence` channel for their friends.
4. Client sends a heartbeat (`{"type":"ping"}`) every 25s; server refreshes the presence TTL and replies `{"type":"pong"}`.
5. On disconnect (clean or timeout), server removes the socket registration; if it was the user's last active socket, presence flips to offline after a short grace period (avoids "flickering" offline/online on brief reconnects, e.g. switching wifi to cellular).

### 3.2 Event catalogue

**Messaging**
```json
{ "type": "typing",       "data": { "chatId": "...", "isTyping": true } }
{ "type": "message.new",  "data": { ...Message } }
{ "type": "message.ack",  "data": { "messageId": "..." } }
{ "type": "message.read", "data": { "messageId": "...", "userId": "..." } }
{ "type": "message.reaction", "data": { "messageId": "...", "userId": "...", "emoji": "❤️" } }
```

**Presence**
```json
{ "type": "presence", "data": { "userId": "...", "online": true, "lastSeen": "..." } }
```

**Calls (WebRTC signaling relay — server never touches media, see BACKEND.md §7)**
```json
{ "type": "call.offer" | "call.answer" | "call.ice" | "call.hangup", "data": { "callId": "...", ... } }
{ "type": "call.incoming", "data": { "callId": "...", "fromUserId": "...", "callType": "video" } }
{ "type": "call.ended",    "data": { "callId": "...", "reason": "hangup|declined|missed" } }
```

**Contacts**
```json
{ "type": "friend.request",  "data": { "requestId": "...", "fromUserId": "..." } }
{ "type": "friend.accepted", "data": { "userId": "..." } }
```

**Status**
```json
{ "type": "status.new",      "data": { ...StatusPost } }                 // pushed to friends when someone posts
{ "type": "status.viewed",   "data": { "statusId": "...", "userId": "..." } }
{ "type": "status.reaction", "data": { "statusId": "...", "userId": "...", "emoji": "🔥" } }
```

### 3.3 Scaling across multiple instances
A single FastAPI process holds the actual socket, but events can originate anywhere (e.g. a REST call handled by a different instance). Flow:
1. Any service (message_service, status_service, call_service) publishes an event to a Redis channel keyed by `chat:{chat_id}`, `user:{user_id}`, or `friends:{user_id}` — it never talks to sockets directly.
2. Every API instance subscribes to the channels for the sockets it's currently holding.
3. When a subscribed message arrives, the instance pushes it down the matching live WebSocket(s).

This means a user connected to Instance B still gets a message sent by someone whose REST request landed on Instance A — required for any real horizontal scaling.

---

## 4. Users & Profiles (photo / video)

### Data
```
User (extended)
  id, username, email, phone (nullable), password_hash,
  display_name, bio, avatar_url, avatar_video_url (nullable — short looping video avatar, unique touch),
  cover_photo_url (nullable),
  is_verified, totp_secret (nullable),
  last_seen_at, last_seen_visibility (enum: everyone/friends/nobody),
  created_at
```

### Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/users/{user_id}` | Public profile (respects privacy settings) |
| PATCH | `/users/me` | Update display name, bio, privacy settings |
| POST | `/users/me/avatar` | Upload profile photo (or short video avatar) → presigned upload → Celery generates a cropped thumbnail + (for video) a static poster frame |
| POST | `/users/me/cover-photo` | Upload profile cover/banner image |
| GET | `/users/search?q=` | Find people by username/phone (respects "who can find me" privacy setting) |

Profile photo upload reuses the same presign → complete → Celery-processing pipeline as message attachments (`BACKEND.md §5/§6`) — one upload pathway, not a special case.

---

## 5. Friends / Contacts System

WhatsApp treats your phone contacts as the graph; TALK CONNECT adds an **explicit in-app friend graph** on top (more control, works without phone-number sync, and is what powers Status visibility).

### Data
```
FriendRequest   id, from_user_id, to_user_id, status (pending/accepted/declined/cancelled), created_at, responded_at
Friendship      user_id_a, user_id_b (ordered pair, unique constraint), created_at   # symmetric edge, created on accept
Block           blocker_id, blocked_id, created_at
ContactSync     id, user_id, phone_hash (sha256, never store raw numbers), matched_user_id (nullable)  # optional phone-contact matching, privacy-preserving via hashing
```

### Endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/friends/requests` | Send a friend request `{ toUserId }` |
| GET | `/friends/requests?direction=incoming\|outgoing` | List pending requests |
| POST | `/friends/requests/{id}/accept` | Accept → creates `Friendship` row both ways, pushes `friend.accepted` over WS |
| POST | `/friends/requests/{id}/decline` | Decline |
| DELETE | `/friends/requests/{id}` | Cancel a request you sent |
| GET | `/friends` | List current friends (with online status, last seen) |
| DELETE | `/friends/{user_id}` | Unfriend |
| POST | `/friends/{user_id}/block` | Block (also auto-removes friendship, hides from search, blocks messages/calls) |
| DELETE | `/friends/{user_id}/block` | Unblock |
| POST | `/contacts/sync` | Client uploads **hashed** phone numbers → server matches against hashed numbers of existing users → returns which contacts are already on the app (never exposes raw numbers either direction) |

### Authorization tie-ins
- Starting a 1:1 chat, viewing Status, and seeing "last seen" all check `Friendship` (or a more permissive privacy setting) before allowing it.
- A `Block` row short-circuits everything: blocked users can't message, call, view status, or find the blocker in search — checked as a fast Redis-cached lookup before hitting Postgres on hot paths.

---

## 6. Status / Stories (photo & video, with likes & reactions)

A 24-hour ephemeral feed, visible to friends by default, with per-post privacy control — plus a distinctive feature WhatsApp doesn't have: **status reactions with an emoji picker and a public like-count**, not just private "seen by" replies.

### Data
```
StatusPost      id, user_id, type (image/video/text), storage_key (nullable for text-only),
                 caption, background_style (for text status — gradient/color id), 
                 privacy (enum: friends/close_friends/only_share_with/except),
                 audience_ids (jsonb array, used when privacy = only_share_with / except),
                 created_at, expires_at (created_at + 24h, enforced by a Celery sweep job)

StatusView      status_id, viewer_id, viewed_at                     # "seen by" list, only visible to the poster
StatusReaction  status_id, user_id, emoji, created_at                # public-ish: poster sees who reacted; unlike WhatsApp, reaction counts are visible to all viewers
StatusReply     id, status_id, from_user_id, message text, created_at  # becomes a normal DM under the hood, tagged as a status reply
```

### Endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/status` | Create a status post (image/video via presigned upload, or text with a background style) |
| GET | `/status/feed` | Friends' active (non-expired) status, grouped by user, ordered by unseen-first |
| GET | `/status/{status_id}` | Single status detail |
| DELETE | `/status/{status_id}` | Delete own status early |
| POST | `/status/{status_id}/view` | Record a view (idempotent — one row per viewer) → pushes `status.viewed` to the poster in real time so they see the viewer count tick up live |
| GET | `/status/{status_id}/views` | Poster-only: list of who viewed + when |
| POST | `/status/{status_id}/react` | Add/change reaction emoji → pushes `status.reaction` over WS |
| DELETE | `/status/{status_id}/react` | Remove own reaction |
| POST | `/status/{status_id}/reply` | Reply privately → creates a `StatusReply` + a normal `Message` in a 1:1 chat, tagged with `context = status_reply` so the UI can show "Replied to your status" |
| GET | `/status/{status_id}/reactions` | List of reactions with emoji + user (visible to anyone who can view the status — this is the unique "public-ish" twist) |

### Behavior details
- **Expiry:** `expires_at` set at creation (+24h); a Celery beat job runs every few minutes, soft-deletes expired posts, and purges the underlying media from storage after a short retention buffer (in case of "recently expired" undo).
- **Privacy resolution order:** `except` (everyone except listed users) → `only_share_with` (only listed users) → `close_friends` (a user-curated subset of `Friendship`) → `friends` (default, all accepted friends). Checked in `require_status_visible(status_id)`, the same authorization-dependency pattern as §2.
- **Ring indicator logic (frontend-facing but defined here):** the API returns `has_unseen: bool` per user in `/status/feed` so the client can render the gradient "unseen" ring vs. a muted "seen" ring around avatars — matches the visual language in `DESIGN.md` (Aurora Pulse ring = "something new here").
- **Highlights (unique idea):** optional `POST /status/{id}/highlight` lets a user pin a status past 24h to a permanent "Highlights" shelf on their profile (like Instagram Highlights) — stored as a simple `is_highlighted` flag that exempts that post from the expiry sweep.

---

## 7. Generic Reactions System (reused by messages *and* status)

Rather than building two separate reaction systems, use one polymorphic pattern:

```
Reaction   id, target_type (enum: message/status), target_id (UUID), user_id, emoji, created_at
           UNIQUE (target_type, target_id, user_id)   -- one reaction per user per target, changing emoji updates the row
```

`message_service.react()` and `status_service.react()` both call the same `reaction_service.upsert_reaction(target_type, target_id, user, emoji)` — one code path, one WS event shape (`{type: "<target>.reaction", data: {...}}`), one place to add moderation/rate-limiting later.

---

## 8. "Must-Have Messenger Features" Checklist

Cross-referencing WhatsApp/Telegram/Messenger so nothing foundational is missing from the build plan:

- [x] Registration + login with hashed passwords, JWT access/refresh (§1)
- [x] Authorization separated from authentication for every action (§2)
- [x] 1:1 and group chats, admin roles (`BACKEND.md`)
- [x] Realtime delivery: sent/delivered/read ticks, typing indicator (§3, `BACKEND.md`)
- [x] Presence: online/offline, last seen, with a privacy toggle (§4, §3.1)
- [x] Voice calls, video calls, group calls via SFU (`BACKEND.md §7`)
- [x] Push notifications, multi-device, batching, quiet hours (`BACKEND.md §9`)
- [x] Media sharing: photos, videos, voice notes, documents (`BACKEND.md §5`)
- [x] Large/dev-file transfer beyond normal attachment limits — "Vault" (`BACKEND.md §8`)
- [x] Contacts/friends graph, requests, block/unblock (§5)
- [x] Status/Stories with 24h expiry, privacy control, views, and — as a differentiator — public reactions with emoji + visible counts (§6)
- [x] Message reactions, replies, edit, delete, forward (`BACKEND.md §5`, §7 here)
- [x] Disappearing messages / disappearing chats (`BACKEND.md §10`)
- [x] Group management: add/remove members, rename, group photo, admin transfer
- [x] Message search (add `GET /chats/{chat_id}/messages/search?q=` backed by Postgres full-text search or a dedicated search index like Meilisearch for scale)
- [x] Account security: 2FA, new-device alerts, "log out of all devices" (§1.3)
- [x] Data export / delete-account flow (`POST /users/me/export`, `DELETE /users/me` — required for GDPR-style compliance, worth building even for a learning project since it's good practice)

Anything not yet covered in either doc that's still worth planning for as the project grows: end-to-end encryption toggle per chat (flagged in `BACKEND.md §11`), backup/restore of chat history, and a public/business-account variant (verified badge, auto-replies) — good candidates for a "v4" doc once the core is working.
