# TALK CONNECT — Backend v4 (Final): Auth, Profiles, Groups, Status, Realtime Calls & Neon DB

This is the consolidated build doc — signup/login, profile creation & editing, avatar system (uploaded photo **and** preset icon avatars), group creation, friends, Status/Stories, and real-time voice/video calls via **LiveKit**, wired to your **Neon PostgreSQL** database.

Read alongside: `BACKEND.md` (Vault large-file transfer, notifications, base structure) and `BACKEND-AUTH-REALTIME-STATUS.md` (auth/authorization deep dive, WebSocket contract, friends/status detail). This doc is the "wire it all together + ship it" version.

---

## ⚠️ 0. Database Credentials — Do This First

You shared your Neon connection string with the password visible in plain text. **Rotate it now** (Neon dashboard → your project → Settings → Reset password), then use the new one only inside a local `.env` file that's git-ignored. Never hardcode a connection string in source files, and never paste one into a chat again — treat it like a login password, because it is one.

### `.env` (local only, in `.gitignore`)
```
DATABASE_URL=postgresql+asyncpg://neondb_owner:<NEW_PASSWORD>@ep-spring-paper-ay57unrz-pooler.c-5.us-east-2.aws.neon.tech/neondb?ssl=require
JWT_SECRET=<generate with: openssl rand -hex 32>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30
REDIS_URL=redis://localhost:6379/0
S3_BUCKET=talk-connect-media
S3_ENDPOINT=<your R2/S3 endpoint>
S3_ACCESS_KEY=<...>
S3_SECRET_KEY=<...>
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=<...>
LIVEKIT_API_SECRET=<...>
CORS_ORIGINS=https://talkconnect.vercel.app
```

### `core/config.py`
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    redis_url: str
    s3_bucket: str
    s3_endpoint: str
    s3_access_key: str
    s3_secret_key: str
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    cors_origins: list[str] = []

    class Config:
        env_file = ".env"

settings = Settings()
```

### `db/session.py` — Neon-specific notes
Neon is serverless Postgres with connection pooling built in (the `-pooler` in your host is PgBouncer transaction mode). Two things matter for SQLAlchemy async:
```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,     # Neon can suspend idle compute; this checks the connection is alive before use
    pool_size=5,             # keep small — Neon's pooler already pools upstream
    max_overflow=5,
    connect_args={"ssl": "require"},
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```
- Use the **pooled** connection string (the one you have, with `-pooler` in the hostname) for the app itself.
- For **Alembic migrations**, use Neon's **direct** (non-pooled) connection string instead — DDL statements and long-running migrations don't play well through PgBouncer transaction mode. Get the direct string from the Neon dashboard (same project, "Connection string" tab, toggle "Pooled connection" off) and put it in `alembic.ini` / a separate `MIGRATIONS_DATABASE_URL` env var.
- Neon auto-suspends compute after inactivity on the free tier — the first request after idle time will be a bit slower (cold start); `pool_pre_ping=True` above handles this gracefully instead of throwing a stale-connection error.

---

## 1. Signup & Login (recap, tied to Neon + this doc's scope)

| Method | Path | Behavior |
|---|---|---|
| POST | `/auth/register` | `{ username, email, password }` → hash password (bcrypt) → insert `User` row into Neon → **no tokens yet** |
| POST | `/auth/login` | Verify password → issue access (15 min) + refresh (30 day, httpOnly cookie) JWT pair → upsert `Device` |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke refresh token |
| GET | `/auth/me` | Return own profile |

Full detail (rate limiting, 2FA, password reset) is in `BACKEND-AUTH-REALTIME-STATUS.md §1`. Nothing changes here except the DB is now concretely Neon.

---

## 2. Profile — Create & Edit

```
User
  id, username (unique), email (unique), phone (nullable), password_hash,
  display_name, bio, status_text,
  avatar_type (enum: photo/icon), avatar_url (nullable), avatar_icon_id (nullable, FK to AvatarIcon),
  cover_photo_url (nullable),
  last_seen_at, last_seen_visibility (enum: everyone/friends/nobody),
  created_at, updated_at
```

| Method | Path | Description |
|---|---|---|
| GET | `/users/{user_id}` | Public profile (privacy-filtered) |
| PATCH | `/users/me` | Edit `display_name`, `bio`, `status_text`, privacy settings |
| POST | `/users/me/avatar/photo` | Upload a real photo avatar (presigned upload → Celery crop/thumbnail, same pipeline as message attachments) |
| POST | `/users/me/avatar/icon` | Set avatar to a preset icon (`{ avatarIconId }`) instead of a photo — instant, no upload needed |
| POST | `/users/me/cover-photo` | Upload profile cover/banner |
| GET | `/users/search?q=` | Find people by username (privacy-aware) |

### Icon Avatars (unique, fast-onboarding touch)
Not every user wants to upload a photo immediately — give them a set of **generated icon avatars** to pick at signup, similar to Slack/Discord's default avatars but on-brand:
```
AvatarIcon   id, style (enum: gradient-initials / abstract-shape / character), config (jsonb), preview_url
```
- `gradient-initials`: server renders (or pre-generates at build time) a set of avatars using the two initials of the display name over an **Aurora Pulse**-family gradient background (see `DESIGN.md`) — deterministic per user so it's consistent everywhere it's shown, no image upload required.
- Offer ~12–16 preset options at signup; user can switch to a real photo anytime via `POST /users/me/avatar/photo`, which flips `avatar_type` to `photo`.
- Frontend renders `avatar_type == "icon"` as an SVG/CSS gradient component (cheap, no network image fetch); `avatar_type == "photo"` as a normal `next/image`.

---

## 3. Groups

```
Chat          id, is_group (bool), name, avatar_url, avatar_icon_id (nullable, groups can also use an icon avatar), created_by, created_at
ChatMember    chat_id, user_id, role (enum: member/admin/owner), joined_at, muted, notifications_level
```

| Method | Path | Description |
|---|---|---|
| POST | `/chats/groups` | Create a group: `{ name, memberUserIds[] }` — creator becomes `owner`, others `member`; only **friends** can be added directly (non-friends get an invite/join-request instead, see below) |
| PATCH | `/chats/{chat_id}` | Rename / change avatar (`admin`+) |
| POST | `/chats/{chat_id}/members` | Add member(s) — `admin`+, and each added user must be a friend of the adder or must accept a join invite |
| DELETE | `/chats/{chat_id}/members/{user_id}` | Remove member (`admin`+) or leave (self) |
| POST | `/chats/{chat_id}/members/{user_id}/promote` | Grant admin (`owner` only) |
| POST | `/chats/{chat_id}/members/{user_id}/demote` | Revoke admin (`owner` only) |
| POST | `/chats/{chat_id}/leave` | Leave a group; if the `owner` leaves, ownership auto-transfers to the earliest-joined remaining admin |

Authorization: every mutating group route uses `require_chat_admin(chat_id)` or a stricter `require_chat_owner(chat_id)` (same dependency pattern as `BACKEND-AUTH-REALTIME-STATUS.md §2`).

---

## 4. Friends System (recap — powers who can be added to groups and who sees Status)

See `BACKEND-AUTH-REALTIME-STATUS.md §5` for the full endpoint list (`/friends/requests`, accept/decline, block/unblock, hashed contact sync). Groups and Status both key off the same `Friendship` table — one social graph, reused everywhere, instead of separate "chat contacts" and "status contacts" lists.

---

## 5. Status System (recap — WhatsApp-style, with public reaction counts as the twist)

See `BACKEND-AUTH-REALTIME-STATUS.md §6` for full detail: 24h-expiring photo/video/text status, privacy rules (friends / close friends / custom), view tracking, replies-as-DM, and reactions. No changes needed here — it plugs directly into the `User` and `Friendship` models defined in this doc.

---

## 6. Real-Time Voice & Video Calls — LiveKit

Switching the whole call system (not just group calls) to **LiveKit** simplifies things a lot: instead of hand-rolling P2P WebRTC signaling for 1:1 and a separate SFU path for groups, LiveKit's SFU handles **both** — one consistent code path, better reliability on bad networks, and built-in features (recording, noise cancellation, simulcast) you'd otherwise build yourself.

### 6.1 How it works
1. Client calls `POST /calls` to start a call in a chat → server creates a `Call` row and a matching **LiveKit room** (`livekit-server-sdk`'s `RoomServiceClient.create_room()`), named after the `call_id`.
2. Server pushes `call.incoming` over the existing WebSocket (see `BACKEND-AUTH-REALTIME-STATUS.md §3.2`) to the other chat member(s), plus a push notification if they're not actively connected.
3. Each participant calls `POST /calls/{call_id}/join` → server checks `require_chat_member` (authorization) → generates a **short-lived LiveKit access token** scoped to just that room and that participant's identity → returns it to the client.
4. Client connects directly to LiveKit (`LIVEKIT_URL`) using that token via the LiveKit client SDK (`livekit-client` for web) — audio/video flows client ↔ LiveKit, never through FastAPI.
5. `POST /calls/{call_id}/leave` (or a LiveKit webhook on `participant_left`/`room_finished`) updates `CallParticipant.left_at` and, once everyone's gone, `Call.ended_at` + computed `duration_seconds`.

### 6.2 Token generation (server-side)
```python
from livekit import api

def create_livekit_token(room_name: str, user_id: str, display_name: str) -> str:
    token = api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
    token.identity = user_id
    token.name = display_name
    token.video_grants = api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
    )
    token.ttl = timedelta(hours=2)   # generous enough for a long call, still bounded
    return token.to_jwt()
```

### 6.3 Endpoints (replaces the manual-SDP version from `BACKEND.md §7`)
| Method | Path | Description |
|---|---|---|
| POST | `/calls` | Start a call in a chat → creates `Call` + LiveKit room |
| POST | `/calls/{call_id}/join` | Authorize membership → return `{ livekitUrl, token }` |
| POST | `/calls/{call_id}/leave` | Mark this participant as left |
| GET | `/calls/{call_id}` | Call status + current participants |
| GET | `/calls/history?chat_id=` | Missed/answered call log |
| POST | `/webhooks/livekit` | LiveKit server webhook receiver — `room_started`, `participant_joined/left`, `room_finished`, `track_published` (e.g. detect screen-share start) → keeps `Call`/`CallParticipant` rows in sync even if a client disconnects ungracefully |

### 6.4 Why this is still "real-time" and why it scales
- Signaling (who's calling whom, ringing state) still goes over your FastAPI WebSocket — fast, small messages.
- Media (audio/video/screen-share) goes over LiveKit's own SFU infrastructure — this is what makes group calls scale (bandwidth stays roughly constant per participant instead of growing with the square of participant count, which is what kills plain P2P mesh calls past 3–4 people).
- 1:1 calls get the same reliability benefits LiveKit gives groups: automatic reconnection, adaptive bitrate on bad connections, and consistent behavior across devices — worth the small extra complexity versus rolling your own TURN-only P2P path for just the 1:1 case.
- LiveKit Cloud has a free tier good enough for development and small-scale production; self-hosting LiveKit (Docker/Helm) is a drop-in swap later if you outgrow it — same API either way, you just change `LIVEKIT_URL`.

---

## 7. Consolidated Data Model Summary (Neon / Postgres)

```
User, Device, Friendship, FriendRequest, Block, ContactSync, AvatarIcon
Chat, ChatMember
Message, MessageStatus, Attachment
StatusPost, StatusView, StatusReply
Reaction (polymorphic: target_type message|status, target_id, user_id, emoji)
FileTransfer (Vault)
Call, CallParticipant
Notification
```

Run one Alembic migration chain across all of these against Neon's **direct** connection string (§0). Suggested build/migration order, matching real dependency order:
1. `User`, `Device`, `AvatarIcon`
2. `Friendship`, `FriendRequest`, `Block`, `ContactSync`
3. `Chat`, `ChatMember`
4. `Message`, `MessageStatus`, `Attachment`, `Reaction`
5. `StatusPost`, `StatusView`, `StatusReply`
6. `Call`, `CallParticipant`
7. `FileTransfer`, `Notification`

---

## 8. Environment & Deployment Delta (vs. `DEPLOYMENT.md`)

Add to your hosting provider's (Railway/Render/Fly) environment variables:
```
DATABASE_URL=<Neon pooled connection string, new rotated password>
MIGRATIONS_DATABASE_URL=<Neon direct connection string>
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```
And add `POST /webhooks/livekit` to your CORS/allow-list exceptions if LiveKit Cloud needs to reach it — verify the webhook signature (LiveKit signs its webhook payloads) so this endpoint can't be spoofed.

---

## 9. Final Feature Coverage Check (this doc + the other two)

- [x] Signup / login, hashed passwords, JWT access+refresh — `§1` here, full detail in `BACKEND-AUTH-REALTIME-STATUS.md §1`
- [x] Profile creation & editing — `§2`
- [x] Avatars: uploaded photo **and** preset icon avatars — `§2`
- [x] Group creation, roles (owner/admin/member), add/remove/promote — `§3`
- [x] Friends system — `§4` (full detail in the other doc)
- [x] Status/Stories with reactions — `§5` (full detail in the other doc)
- [x] Real-time messaging over WebSocket — `BACKEND-AUTH-REALTIME-STATUS.md §3`
- [x] Real-time voice & video calls via LiveKit, 1:1 and group — `§6`
- [x] Neon PostgreSQL wired in correctly (pooled vs. direct connection, cold-start handling) — `§0`
- [x] Large dev-file transfer, notifications, media attachments — `BACKEND.md`
