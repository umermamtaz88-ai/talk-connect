# TALK CONNECT — Live Location, File Sharing & Chat Experience Recap

One new feature (**Live Location**) plus a consolidated view of everything you already have specced (file sharing, notifications/ringtone, presence, status reactions) so it's all in one place for Cursor, with pointers back to the detailed docs for each.

---

## 1. New Feature: Live Location Sharing

Share your real-time moving location in a chat for a set duration (like WhatsApp's Live Location) — different from a one-time pin drop.

### 1.1 Data
```
LocationShare   id, chat_id, sender_id, latitude, longitude, accuracy_meters,
                 started_at, expires_at, status (enum: active/stopped/expired),
                 last_updated_at
```
A `LocationShare` is its own record, not a `Message` field — it needs frequent updates (every few seconds while active) without rewriting message history each time. A single system `Message` (`type: "location_share"`) references the `LocationShare.id` and renders a live map card that reads from it.

### 1.2 Endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/chats/{chat_id}/location/start` | `{ latitude, longitude, durationMinutes }` → creates `LocationShare`, posts a `location_share` message, starts the live session |
| PATCH | `/location/{share_id}` | `{ latitude, longitude, accuracy }` → updates position (called every 5–10s by the sender's client while sharing is active) |
| POST | `/location/{share_id}/stop` | Sender manually ends sharing early |
| GET | `/location/{share_id}` | Current position + expiry (for anyone who missed the live WS updates, e.g. just opened the chat) |

A background sweep (same Celery pattern as Status expiry) flips any `LocationShare` past `expires_at` to `status = expired`.

### 1.3 Realtime
Reuses the existing multiplexed WebSocket (`BACKEND-AUTH-REALTIME-STATUS.md §3`) — one more event type, no new connection:
```json
{ "type": "location.update", "data": { "shareId": "...", "latitude": ..., "longitude": ..., "expiresAt": "..." } }
{ "type": "location.stopped", "data": { "shareId": "...", "reason": "manual|expired" } }
```
Position updates publish to the same `chat:{chat_id}` Redis channel as messages/typing — every participant's client updates the map pin live without polling.

### 1.4 Frontend
- Composer attach menu gets a "Location" option alongside photo/document/Vault.
- Starting a share opens a duration picker (15 min / 1 hour / Until I stop it) over a small embedded map preview.
- The resulting chat message renders as a **map card** (static map image is the fallback/thumbnail, becomes a live embedded map with a moving pin once the card is in view) with a countdown ("Live for 42 more minutes") and a "Stop sharing" button visible only to the sender.
- Battery/permission handling: request geolocation permission contextually (only when the user taps "Share Location," never on app load), and clearly show a persistent in-app indicator (small pulsing dot in the header) while an active share is running, so the sender never forgets they're broadcasting their location.
- On the receiving end, tapping the map card opens a full-screen live map view.
- Use `navigator.geolocation.watchPosition()` on the sender's client, throttled to the 5–10s update interval in §1.2 — don't fire a PATCH on every single geolocation callback, which can arrive much more frequently than needed and would flood the socket.

### 1.5 Privacy & safety
- Location sharing always has a hard expiry — no "share forever" option, to avoid it becoming a passive surveillance feature.
- A share can only be stopped early by the sender (or a chat admin removing the message in a group), never by a recipient.
- The persistent header indicator (§1.4) exists specifically so location sharing is never silently ongoing without the sender being reminded.

---

## 2. Everything Else You Asked About — Already Specced, Here's Where

| You mentioned | Status | Where it's detailed |
|---|---|---|
| **File sharing in chat** | ✅ Already specced — normal attachments (≤25MB, presigned upload) and large developer-file transfer via **Vault** (chunked, resumable, dedup) | `BACKEND.md §5` (uploads), `§8` (Vault) |
| **Notification + ringtone** | ✅ Already specced — message pop sound, mention ping, and a looping ringtone for incoming calls that keeps ringing until answered/declined, wired to real WS events, respecting mute/Focus Sync | `NOTIFICATIONS-SOUND.md` (full engine + code) |
| **Presence (friend online/offline)** | ✅ Already specced — Redis-backed presence with a heartbeat, grace period so brief reconnects don't flicker offline, shown as the avatar ring state in the chat list | `BACKEND-AUTH-REALTIME-STATUS.md §3.1`, `FRONTEND-DESIGN-SYSTEM.md §3.2` |
| **Status reactions ("good or bad")** | ✅ Already specced as a full emoji reaction picker (❤️😂😮😢🙏🔥) — see §3 below for adding a simple thumbs up/down as a quick-tap option alongside it | `BACKEND-AUTH-REALTIME-STATUS.md §6–7`, `FRONTEND-DESIGN-SYSTEM.md §2.5, §3.4` |
| **Reply/message on someone's status** | ✅ Already specced — `POST /status/{id}/reply` turns into a real DM tagged "Replied to status" | `BACKEND-AUTH-REALTIME-STATUS.md §6` |
| **Fast page load** | ✅ Already specced as a full performance engineering doc — virtualized lists, Server Components split, skeleton screens, image optimization, Core Web Vitals budget | `PERFORMANCE-ANIMATION.md` (the whole doc — see §4 below for the two highest-impact items specifically) |

---

## 3. Adding a Quick Thumbs Up/Down to Status (on top of the emoji picker)

You mentioned reacting "good or bad" specifically — that reads as wanting a **faster, single-tap option** in addition to the full emoji picker, not a replacement for it (the emoji picker stays for expressive reactions; thumbs up/down is for a near-zero-effort reaction).

- Reuses the exact same `Reaction` model from `BACKEND-AUTH-REALTIME-STATUS.md §7` — `👍` and `👎` are just two more emoji values, no schema change needed.
- On the frontend, show `👍`/`👎` as two small persistent buttons directly under a status (single tap, no long-press needed), with the full 6-emoji picker still reachable via long-press for anyone who wants more nuance.
- Since it's the same `Reaction` table, counts and the live `status.reaction` WS event both already work for these two emoji with zero backend changes.

---

## 4. The Two Highest-Impact Things for "Load Quickly" (do these first)

If you only implement two things from `PERFORMANCE-ANIMATION.md` right now, make it these — they have the biggest effect on how fast the app *feels* to open:

1. **Virtualize the message list and chat list** (`react-virtuoso`) — an un-virtualized long chat history is the single most common cause of a chat app feeling slow, regardless of how fast the network/API is.
2. **Server Component shell + code-split client islands** — render the chat list and static layout as a Server Component for instant first paint, and lazy-load the heavy client-only pieces (call UI, LiveKit SDK, live map view from §1) with `next/dynamic(..., { ssr: false })` so they're not part of the initial JS bundle someone downloads just to see their chat list.

Everything else in that doc (skeletons, optimistic sends, image sizing, font loading) compounds on top of these two, but these two alone will be the most noticeable improvement.

---

## 5. Cursor Task List

```
1. Add LocationShare model + Alembic migration.
2. Implement POST /chats/{chat_id}/location/start, PATCH /location/{share_id}, POST /location/{share_id}/stop, GET /location/{share_id}.
3. Add location.update / location.stopped WS events, published to the existing chat:{chat_id} Redis channel.
4. Add a Celery sweep job to expire LocationShare rows past expires_at (mirror the existing Status expiry job).
5. Frontend: add "Location" to the composer attach menu, build the live map card message renderer, wire navigator.geolocation.watchPosition() on the sender side throttled to 5-10s updates.
6. Add a persistent "sharing location" indicator in the chat header while active.
7. Add 👍/👎 as always-visible quick-tap buttons under Status posts (same Reaction endpoint as the emoji picker — no backend change needed, frontend only).
8. Verify react-virtuoso is actually wired into both the message thread and the chat list (not just installed) — this is the biggest lever for "loads quickly," check it first if the app still feels slow after other fixes.
9. Split the call/LiveKit UI and the live location map view into next/dynamic(..., { ssr: false }) chunks so they're excluded from the initial bundle.
```
