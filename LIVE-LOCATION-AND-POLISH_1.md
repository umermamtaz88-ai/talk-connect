# TALK CONNECT — Live Location Sharing (Google Maps) + Feature Tie-Together

This adds the one genuinely new piece from your last message — **live location sharing in chat** — and ties it together with features already specified elsewhere so Cursor has one clear reference instead of hunting across files.

| You asked for | Status | Where it's specified |
|---|---|---|
| Share files in chat | Already specified | `BACKEND.md §5` (attachments), `§8` (Vault for large files) |
| Live location sharing | **New — specified below** | `§1` here |
| Message notification + ringtone | Already specified | `NOTIFICATIONS-SOUND.md` |
| Presence (friend online/offline) | Already specified | `BACKEND-AUTH-REALTIME-STATUS.md §3` |
| Status reactions | Already specified (full emoji set) | `BACKEND-AUTH-REALTIME-STATUS.md §6` — see `§2` below for a simpler good/bad variant if that's what you actually want instead |
| Reply to a status | Already specified | `BACKEND-AUTH-REALTIME-STATUS.md §6` (`StatusReply`) |
| Fast page load | Already specified | `PERFORMANCE-ANIMATION.md` — see `§3` here for the Google-Maps-specific addition |

---

## 1. Live Location Sharing

Two modes, matching what WhatsApp/Telegram both settled on: a **one-time pin** (where I am right now) and **live sharing** (my location keeps updating for a set duration, visible to the recipient in real time on a map inside the chat).

### 1.1 Data
```
LocationShare   id, message_id (FK), sender_id, chat_id,
                 mode (enum: static/live),
                 latitude, longitude, accuracy_meters,
                 expires_at (nullable — only set for live mode),
                 stopped_early (bool, default false),
                 last_updated_at
```
A `LocationShare` is attached to a `Message` the same way an `Attachment` is (`message.type = "location"`), so it flows through the exact same chat/message pipeline instead of needing a parallel system.

### 1.2 Endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/chats/{chat_id}/messages/location` | Send a static pin: `{ latitude, longitude }` → creates a `Message` (type=location) + `LocationShare` (mode=static) |
| POST | `/chats/{chat_id}/messages/location/live` | Start live sharing: `{ latitude, longitude, durationMinutes }` → creates the message + a `LocationShare` (mode=live) with `expires_at` set |
| PATCH | `/location-shares/{id}` | Update coordinates during an active live share — called periodically by the sharer's device |
| POST | `/location-shares/{id}/stop` | Stop sharing early (`stopped_early = true`, `expires_at` set to now) |
| GET | `/location-shares/{id}` | Current state — used by the recipient's map view on load |

### 1.3 Real-time updates (WebSocket, not polling)
```json
{ "type": "location.update", "data": { "locationShareId": "...", "latitude": ..., "longitude": ..., "accuracyMeters": ... } }
{ "type": "location.stopped", "data": { "locationShareId": "...", "reason": "expired" | "stopped_by_sender" } }
```
The sharer's device sends a `PATCH` on an interval (e.g. every 5–10 seconds, or on significant movement via the browser Geolocation API's `watchPosition`), the backend updates the `LocationShare` row and immediately re-publishes `location.update` over the chat's Redis pub/sub channel, same fan-out mechanism as every other realtime event in this app (`BACKEND-AUTH-REALTIME-STATUS.md §3.3`) — never poll the recipient's client for updates.

A background Celery-beat sweep (same pattern as Status expiry) flips any `LocationShare` past its `expires_at` to stopped and fires `location.stopped`.

### 1.4 Frontend
```tsx
// components/chat/LocationMessage.tsx
"use client";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";

export function LocationMessage({ share }: { share: LocationShare }) {
  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
  });

  if (!isLoaded) return <MapSkeleton />; // layout-matched skeleton, not a spinner — see PERFORMANCE-ANIMATION.md §6

  return (
    <div className="rounded-2xl overflow-hidden w-72 h-40 relative">
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "100%" }}
        center={{ lat: share.latitude, lng: share.longitude }}
        zoom={15}
        options={{ disableDefaultUI: true, gestureHandling: "none" }} // static preview inside the bubble; tap opens full view
      >
        <Marker position={{ lat: share.latitude, lng: share.longitude }} />
      </GoogleMap>
      {share.mode === "live" && (
        <div className="absolute top-2 left-2 bg-danger text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
          <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="w-1.5 h-1.5 rounded-full bg-white" />
          Live · {formatCountdown(share.expiresAt)}
        </div>
      )}
    </div>
  );
}
```
- Tapping the map preview opens a full-screen view (interactive, gestures enabled) subscribed to `location.update` for that share — the marker smoothly animates (`transform`, not a hard jump) to each new position.
- "Live" pill uses the same pulsing-dot pattern as an active call indicator, for visual consistency.
- Sharer sees a persistent banner at the top of the chat while live sharing is active ("Sharing your location · Stop") so it's never accidentally left running.
- Ask for Geolocation permission contextually — only when the user taps "Share location," never on app load — same principle as notification permissions in `NOTIFICATIONS-SOUND.md §5`.

### 1.5 Privacy & battery
- Live sharing has a hard maximum duration option list (15 min / 1 hour / 8 hours) — no unbounded "forever" option, matching how both WhatsApp and Telegram cap this.
- Stopping is always one tap away, and the recipient is notified (`location.stopped`) the moment it ends, so a map doesn't silently go stale without the recipient realizing.
- On the sending device, reduce `watchPosition` update frequency when the app is backgrounded to save battery, and pause updates entirely if the chat this is being shared to isn't the app's foreground content for both parties (still update the DB on an interval, just less aggressively).

---

## 2. Status Reactions — Simplified Good/Bad Option

`BACKEND-AUTH-REALTIME-STATUS.md §6` already specifies a full emoji reaction set (❤️🔥😂 etc.) with public-visible counts. If what you actually want instead (or in addition) is a simpler thumbs-up/thumbs-down style reaction:

```
POST /status/{status_id}/react   body: { emoji: "👍" | "👎" }
```
No schema change needed — the existing polymorphic `Reaction` model (`BACKEND-AUTH-REALTIME-STATUS.md §7`) already stores an arbitrary emoji string per user per target. Just constrain the frontend's Status-viewer reaction bar to two buttons (👍/👎) instead of the full six-emoji picker, while messages elsewhere in the app can still use the full set. This is a frontend-only decision — same backend either way.

---

## 3. Fast Page Load — Google Maps Specifically

Google Maps' JS SDK is heavy (~150–250KB) and must **never** be in your initial bundle just because one chat somewhere contains a location message.

- Load it only via `useJsApiLoader` inside `LocationMessage`/the full-map view — this is a client component that's already code-split per `PERFORMANCE-ANIMATION.md §5`, so the Maps script only downloads when a location message is actually rendered on screen, not on every app load.
- Use `libraries` param minimally — don't load the Places or Directions libraries unless you're actually building autocomplete-address-search later; each extra library adds to the download.
- The static in-bubble preview (§1.4) can alternatively use the **Maps Static API** (a plain `<img>` of a map, no JS SDK at all) instead of a live interactive `GoogleMap` component for the collapsed chat-bubble view — swap to the full interactive SDK only when the user taps to expand. This avoids loading the JS SDK at all for the common case of just glancing at a location in the chat scroll, and a static `<img>` is trivially cheap and cacheable.
```
https://maps.googleapis.com/maps/api/staticmap?center=LAT,LNG&zoom=15&size=300x160&markers=LAT,LNG&key=YOUR_API_KEY
```
- Everything else in `PERFORMANCE-ANIMATION.md` (virtualized lists, GPU-only animations, optimistic sends, WebSocket-only updates, skeleton screens) still applies — location sharing doesn't change any of that, it's just one more message type flowing through the same fast pipeline.

---

## 4. Cursor Task List

```
1. Add LocationShare model + Alembic migration.
2. Implement POST /chats/{chat_id}/messages/location and /location/live, PATCH /location-shares/{id}, POST /location-shares/{id}/stop, GET /location-shares/{id}.
3. Add location.update / location.stopped WS events, published over the same Redis pub/sub channel as other chat events for that chat_id.
4. Add a Celery-beat sweep that auto-stops any LocationShare past its expires_at.
5. On the frontend: add a "Share Location" option to the composer's attach menu with static/live choice and duration picker for live mode.
6. Build LocationMessage using the Maps Static API for the collapsed bubble preview, and the full @react-google-maps/api GoogleMap component only in the expanded full-screen view.
7. Request Geolocation permission only when the user taps "Share Location," never on load.
8. Add the persistent "Sharing your location · Stop" banner for the sender during an active live share.
9. Confirm the Status reaction bar in the viewer UI — decide full emoji set vs. simplified thumbs up/down, and constrain the frontend picker accordingly (no backend change needed either way).
10. Test end-to-end: send a static pin, confirm it renders correctly for the recipient; start a live share, move (or simulate movement by manually calling PATCH), confirm the recipient's map marker updates in real time without a page refresh; let it expire and confirm both sides see it stop.
```

Add to `.env`:
```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<restrict this key to your domain in the Google Cloud Console — Maps JavaScript API + Maps Static API only, nothing else enabled>
```
Restrict the key by HTTP referrer (your actual deployed domain) in Google Cloud Console before shipping — an unrestricted Maps API key in a public frontend bundle is a common source of surprise billing if left open.
