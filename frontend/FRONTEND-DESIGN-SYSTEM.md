# TALK CONNECT — Frontend Design System v2
**Unique buttons · unique sections · motion system · Next.js implementation**
Mapped directly to your live backend (`DOCUMENTATION.md`) — every screen below references real endpoints and WS events, not placeholders.

---

## 1. Identity Recap (see `DESIGN.md` for the base tokens)

- **Canvas:** Void Indigo `#0B0E1A` (dark) / Paper White `#FAFAFC` (light)
- **Signature gradient — "Aurora Pulse":** `linear-gradient(135deg, #6E56CF 0%, #A78BFA 45%, #FF6B6B 100%)`
- **Brand primary:** Signal Violet `#6E56CF` · **Accent:** Ember Coral `#FF6B6B` · **Online/success:** Aurora Teal `#2DD4BF`
- **Type:** Clash Display / General Sans for headings, Inter for UI/body, tabular numerals for timestamps

This doc adds what wasn't detailed yet: **a real button system**, **section-by-section layout specs**, and **a concrete animation catalogue** with Framer Motion code, all wired to the FastAPI backend you already built.

---

## 2. The Button System (5 distinct variants — not just color swaps)

Most apps have one button with three color reskins. TALK CONNECT has **five behaviorally distinct button types**, each earning its shape through what it does.

### 2.1 `AuroraButton` — primary actions (Send message, Start call, Create account)
Pill-shaped, gradient fill, used sparingly (max one per screen) so it stays a "hero" element.

```tsx
// components/ui/AuroraButton.tsx
"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function AuroraButton({
  children, onClick, loading, disabled, className,
}: { children: React.ReactNode; onClick?: () => void; loading?: boolean; disabled?: boolean; className?: string }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || loading}
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn(
        "relative rounded-full px-6 py-3 font-medium text-white overflow-hidden",
        "bg-[linear-gradient(135deg,#6E56CF_0%,#A78BFA_45%,#FF6B6B_100%)]",
        "shadow-[0_8px_24px_-8px_rgba(110,86,207,0.55)]",
        "disabled:opacity-50 disabled:pointer-events-none",
        className
      )}
    >
      {/* animated sheen sweep on hover — signature micro-interaction */}
      <motion.span
        className="absolute inset-0 bg-white/25 -skew-x-12"
        initial={{ x: "-120%" }}
        whileHover={{ x: "120%" }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
        style={{ width: "40%" }}
      />
      <span className="relative flex items-center justify-center gap-2">
        {loading ? <Spinner /> : children}
      </span>
    </motion.button>
  );
}
```
Used for: `POST /auth/register` submit, `POST /auth/login` submit, message send, `POST /calls` (start call).

### 2.2 `GhostPillButton` — secondary actions (Cancel, Skip, Decline call politely)
Transparent fill, 1.5px border, no gradient — visually "quiet" so it never competes with an `AuroraButton` on the same screen.

```tsx
<button className="rounded-full px-5 py-2.5 border border-border text-text-secondary
  hover:border-brand-primary hover:text-brand-primary transition-colors duration-150">
  Cancel
</button>
```

### 2.3 `IconOrbButton` — icon-only actions in the composer/call bar (attach, mic, camera flip)
Circular, 44×44px minimum touch target (accessibility floor), background morphs on state change rather than just swapping icons.

```tsx
// mic on/off, camera on/off, screen-share toggle
<motion.button
  aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
  onClick={toggleMute}
  animate={{ backgroundColor: isMuted ? "var(--color-danger)" : "var(--color-surface-elevated)" }}
  transition={{ duration: 0.2 }}
  className="w-11 h-11 rounded-full flex items-center justify-center"
>
  <motion.div animate={{ rotate: isMuted ? 0 : 0, scale: [1, 1.15, 1] }} transition={{ duration: 0.25 }}>
    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
  </motion.div>
</motion.button>
```

### 2.4 `MorphSendButton` — the composer's send button (unique signature interaction)
Same physical button crossfades between three states depending on composer content — this is one of the most distinctive touches in the whole app.

```tsx
// components/chat/MorphSendButton.tsx
type ComposerState = "idle" | "typing" | "sending";

export function MorphSendButton({ state, onSend, onHoldToRecord }: { state: ComposerState; onSend: () => void; onHoldToRecord: () => void }) {
  return (
    <button
      onClick={state === "typing" ? onSend : undefined}
      onPointerDown={state === "idle" ? onHoldToRecord : undefined}
      className="relative w-11 h-11 rounded-full grid place-items-center
                 bg-[linear-gradient(135deg,#6E56CF,#FF6B6B)]"
    >
      <AnimatePresence mode="wait">
        {state === "idle" && (
          <motion.div key="mic" initial={{ opacity: 0, scale: 0.6, rotate: -45 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.6 }}>
            <Mic size={18} className="text-white" />
          </motion.div>
        )}
        {state === "typing" && (
          <motion.div key="send" initial={{ opacity: 0, scale: 0.6, rotate: 45 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.6 }}>
            <Send size={18} className="text-white" />
          </motion.div>
        )}
        {state === "sending" && (
          <motion.div key="spin" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}>
            <Loader2 size={18} className="text-white" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}
```
Idle (empty composer) = mic icon, hold-to-record a voice note. Typing = paper-plane, tap to `POST /chats/{chat_id}/messages`. Sending = spinner until `message.ack` arrives over WS.

### 2.5 `ReactionOrbTrigger` — the long-press reaction picker on messages/status
Not a button in the traditional sense — a press-and-hold target that expands into an emoji row, used identically for `POST /messages/{id}/react` and `POST /status/{id}/react` (same backend `Reaction` model, same frontend component).

```tsx
<motion.div
  onTapStart={openReactionBar}
  whileTap={{ scale: 0.95 }}
  className="cursor-pointer"
>
  {/* message or status content */}
</motion.div>

<AnimatePresence>
  {reactionBarOpen && (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="flex gap-1 bg-surface-elevated rounded-full px-2 py-1.5 shadow-lg border border-border/50"
    >
      {["❤️","😂","😮","😢","🙏","🔥"].map((emoji, i) => (
        <motion.button
          key={emoji}
          whileHover={{ scale: 1.4, y: -6 }}
          transition={{ delay: i * 0.03, type: "spring", stiffness: 400 }}
          onClick={() => react(emoji)}
          className="text-xl"
        >
          {emoji}
        </motion.button>
      ))}
    </motion.div>
  )}
</AnimatePresence>
```

---

## 3. Unique Sections — Screen by Screen

### 3.1 Auth Screen — `POST /auth/register`, `/verify`, `/login`
**Layout:** Split-screen on desktop. Left 55%: full-bleed Aurora Pulse gradient with a slow-drifting blurred blob animation (CSS `@keyframes`, GPU-cheap, `transform` only) and the wordmark. Right 45%: form on Void Indigo.
- Register → Verify is a **single animated step-through**, not two page loads: form slides left (`x: "-100%"`) while a 6-digit OTP input slides in from the right, backed by `POST /auth/verify`.
- 2FA step (`totp_code`) only renders if the login response signals it's required — appears as a drawer sliding up from the bottom, not a new page.
- New-device detection (backend logs this as a security signal) surfaces as a dismissible amber banner on next login from a recognized-but-new device.

### 3.2 Sidebar — Chat List — `GET /chats`
**Layout:** 320–360px column. Each row is a `ChatListItem` card (rounded-2xl, soft-depth shadow per `DESIGN.md`).
- **Unique touch — the avatar ring is stateful**, not decorative: solid Aurora Teal ring = online, animated Aurora Pulse gradient ring = has unseen Status (ties into `GET /status/feed`'s per-user `has_unseen`), no ring = offline/no status, dashed amber ring = **Focus Sync active** (`focus.updated` WS event) so you see at a glance someone's "busy until 3pm" without opening their profile.
- Pinned chats (`ChatMember.pinned`) float to the top with a small pin glyph, subtle background tint (4% brand-primary).
- Unread badge: Ember Coral pill, pops in with `scale: [0, 1.15, 1]` spring on `message.new` when the chat isn't open.
- Swipe-left (mobile) reveals Mute / Archive / Pin actions — spring-resisted so a small swipe snaps back, a decisive swipe commits.

### 3.3 Message Thread — `GET /chats/{id}/messages`, WS `message.*`
- Date-pill dividers ("Today") floating over a hairline — never a full-width bar.
- Grouped bubbles (same sender within 2 min) collapse vertical gap to 4px; only the last bubble in a group gets the sharp "tail" corner.
- **Code messages** (`type: "code"`) render as a distinct card, not a bubble: monospace font, syntax highlighting (Shiki), a copy-button in the top-right corner, language pill (`codeLanguage`) top-left — visually and structurally different from a chat bubble so a "Code Room" moment doesn't get lost among regular text.
- **Voice messages** show a waveform (precomputed client-side from the audio blob) + the `transcript` field from the backend as collapsed grey text beneath, expandable on tap — no need to play audio to skim it.
- **Vault/file messages** render as a distinct attachment card with a live progress ring (see §4.4) instead of a static file icon while `status: uploading`.
- Reactions sit as a small pill overlapping the bubble's bottom edge; tapping shows who reacted (name list from the reaction's `user_id`s).
- New message entrance: `initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}` — 180ms, spring, so incoming messages feel like they arrive rather than snap in.

### 3.4 Status / Stories — `GET /status/feed`, viewer, `POST /status/{id}/react`
- **Feed strip** at the top of the chat list: horizontally scrolling avatar row, unseen-first ordering (server already sorts this way), gradient ring per §3.2.
- **Viewer** is full-screen, segmented progress bars at the top (one per status item from that user, like a typical stories UI), auto-advances, tap-hold to pause.
- **The differentiator:** a reaction bar is *always visible* at the bottom (not hidden behind a menu), and — unlike WhatsApp — **reaction counts are visible to the viewer in real time** as they come in via `status.reaction`, rendered as small emoji chips with live counts stacking in from the right edge.
- Reply box at the bottom posts to `POST /status/{id}/reply`, which the backend turns into a real DM — UI shows a small "Replied to status" context chip atop that message in the resulting chat thread.
- Poster-only: swipe up reveals the viewer list (`GET /status/{id}/views`) as a bottom sheet with avatars + relative timestamps.
- **Highlights** (`POST /status/{id}/highlight`) shown as a permanent circular shelf on the profile page, visually distinct from the 24h ring (solid border, small pin icon) so it reads as "kept," not "active."

### 3.5 Friends / Contacts — `/friends/*`
- Three tabs (segmented control, sliding underline animation): **Friends**, **Requests**, **Find People**.
- Incoming request rows have two `GhostPillButton`s (Decline) and one `AuroraButton`-style compact accept — accept triggers a quick confetti-free "connection" animation (two avatar circles sliding together and merging into a ring pulse) instead of just disappearing the row.
- Blocked users live in a separate, deliberately unstyled/flat list in Settings — no gradients, no motion — a small intentional design choice to make a serious action feel serious.

### 3.6 Profile & Settings — `PATCH /users/me`, avatar/cover/focus endpoints
- Cover photo + avatar overlap layout (cover behind, avatar overlapping the bottom edge by 50%, standard profile pattern) but the avatar uses the **icon-vs-photo** system from `BACKEND-FINAL.md §2` — icon avatars render as a live CSS-gradient component so switching between the 12–16 presets is instant with a crossfade, no upload roundtrip.
- **Focus Sync editor**: a bottom-sheet with a duration chip-selector (30m/1h/3h/Custom) and a share-with multi-select of friends — submits to `POST /users/me/focus`, and the confirmation state shows a live preview of exactly what those friends will see.
- Privacy toggles (`read_receipts_enabled`, `typing_indicators_enabled`, `last_seen_visibility`, phone visibility) grouped under one "Privacy" section with a short one-line consequence note under each toggle (e.g. "Turning this off also hides others' read receipts from you") — mirrors the mutual-enforcement logic actually implemented in the backend, not just a generic settings list.

### 3.7 Call Screen — `POST /calls`, `/join`, LiveKit
- Incoming call: full-screen takeover, the caller's avatar pulses with an animated Aurora Pulse ring (`scale`/`opacity` loop, transform-only for perf), Accept (`AuroraButton`, green-shifted for this one context) and Decline (`GhostPillButton`, danger-tinted) buttons slide up from the bottom.
- Active call: participant tiles in a responsive grid (1 = full-bleed, 2 = split, 3+ = grid), `IconOrbButton`s for mute/camera/screen-share/leave along the bottom, each morphing background color on state per §2.3.
- **Adaptive presence badge** on each tile reflects the real backend state (`on_call`, `screen_sharing`) — a small pill in the corner of each tile, not just a static "in call" label.
- Screen-share start (`POST /calls/{id}/screen-share`) triggers the presenter's tile to expand with a smooth grid-reflow animation (Framer Motion `layout` prop) rather than an abrupt re-render.

### 3.8 Vault (Large File Transfer) — `POST /vault`, chunk upload, `/download`
- Distinct from a normal attachment: a dedicated "Send Large File" flow reachable from the composer's attach menu, opens a bottom sheet showing filename, size, and a **chunk-grid visualization** — a small grid of squares (one per chunk) that fill in individually as each `PUT /vault/{id}/chunks/{i}` confirms, rather than one generic progress bar. This directly visualizes the resumable-chunk architecture instead of hiding it.
- Recipient-side download shows the same chunk-grid in reverse (draining) during download, with pause/resume respecting HTTP range requests.
- Expiry/download-limit metadata (`expiresHours`, `downloadLimit`) shown as a small "Expires in 3 days · 4 downloads left" caption — transparency about the self-destructing nature of the link.

---

## 4. Animation Catalogue (concrete, not vibes)

| Interaction | Motion spec | Why |
|---|---|---|
| Message arrives | `opacity 0→1, y 12→0, scale 0.98→1`, spring, ~180ms | Feels like arrival, not a snap-render |
| Send button morph | crossfade + slight rotate per state (§2.4) | One control, three honest states |
| Reaction pop | `scale: [0,1.15,1]`, spring stiffness 500 | Playful without being childish |
| Typing indicator | 3 dots, `staggerChildren: 0.15`, y bounce `[0,-4,0]` loop | Reads as "alive," not robotic |
| Status ring (unseen) | conic-gradient border-image, slow 3s hue drift via CSS `@property` | Signature, low-cost (CSS only, no JS animation loop) |
| Call incoming ring | `scale: [1, 1.08, 1], opacity: [0.6,0.3,0.6]`, 1.4s loop, transform+opacity only | GPU-cheap, won't jank on low-end devices |
| Chunk fill (Vault) | each chunk square: `scale 0.8→1, backgroundColor` transition, 150ms, staggered by arrival not index | Visual = actual upload state, not fake |
| Screen-reflow on share-start | Framer Motion `layout` + `layoutId` on tiles | Smooth grid reflow instead of jump-cut |
| Page/section transitions | `AnimatePresence` with `mode="wait"`, 150–200ms fade+slide | Consistent, never longer than 300ms per UX guideline |
| Reduced motion | every animation above wrapped with a `useReducedMotion()` check that drops to opacity-only or instant | Accessibility — non-negotiable, not optional polish |

```tsx
// hooks/useMotionSafe.ts — wrap every custom animation with this
import { useReducedMotion } from "framer-motion";
export function useMotionSafe() {
  const reduce = useReducedMotion();
  return {
    entrance: reduce ? { opacity: [0, 1] } : { opacity: [0, 1], y: [12, 0], scale: [0.98, 1] },
    transition: reduce ? { duration: 0.15 } : { type: "spring", stiffness: 400, damping: 28 },
  };
}
```

---

## 5. Component-to-Endpoint Map (quick reference for building)

| Component | Backend call(s) |
|---|---|
| `AuthForm` | `POST /auth/register`, `/verify`, `/login`, `/2fa/confirm` |
| `ChatList` | `GET /chats`, WS `chat.new`/`chat.added` |
| `ChatListItem` avatar ring | `GET /status/feed` (has_unseen), Redis presence via WS `presence` |
| `MessageThread` | `GET /chats/{id}/messages`, WS `message.*` |
| `Composer` + `MorphSendButton` | `POST /chats/{id}/messages`, `POST /vault` for large attachments |
| `CodeMessageCard` | message `type: "code"` + `codeLanguage` |
| `StatusFeedStrip` / `StatusViewer` | `GET /status/feed`, `/status/{id}`, `/view`, `/react`, `/reply`, `/highlight` |
| `FriendsPanel` | `/friends/*`, `/contacts/sync` |
| `ProfileSettings` | `PATCH /users/me`, `/me/avatar`, `/me/avatar/icon`, `/me/cover-photo` |
| `FocusSyncSheet` | `POST/DELETE /users/me/focus`, WS `focus.updated` |
| `CallScreen` | `POST /calls`, `/join`, `/leave`, `/screen-share`, WS `call.*` |
| `VaultSheet` | `POST /vault`, `PUT /vault/{id}/chunks/{i}`, `GET /vault/{id}`, `/download` |

---

## 6. Build Notes

- All animation lives in Client Components (`"use client"`) — keep chat list/message fetch as Server Components where possible for fast first paint, hydrate the interactive shell (composer, reactions, call UI) on top.
- Framer Motion `layout` and `AnimatePresence` are used deliberately, not everywhere — every animated element above ties to a real state change from the backend (a WS event, a request completing), never decoration for its own sake, matching the UX guideline that motion should convey meaning.
- Icon set stays Lucide throughout (per `DESIGN.md`) — the only exception is emoji, which are correct here because reactions are genuinely emoji content, not functional icons.
