# TALK CONNECT — Performance & Animation Engineering Guide

**Goal:** every animation in `FRONTEND-DESIGN-SYSTEM.md` should feel instant and buttery — and the app around it (chat scroll, navigation, media) needs to be just as fast, or the animations will feel fake sitting on top of a sluggish app. This doc is the concrete engineering layer that makes "beautiful" also mean "smooth and fast," in Next.js specifically.

---

## 1. The Core Rule: Only Animate `transform` and `opacity`

Every animation in this app must be built from these two CSS properties only. They run on the compositor thread, so they stay smooth even while the main thread is busy (fetching messages, parsing JSON, running React renders).

**Never animate:** `width`, `height`, `top`, `left`, `margin`, `padding`, `box-shadow` size, or `border-width` — these trigger layout recalculation (reflow) and repaint, which is what causes janky, dropped-frame animations.

```tsx
// ❌ Janky — triggers layout on every frame
<motion.div animate={{ width: isOpen ? 320 : 0 }} />

// ✅ Smooth — GPU-composited, no layout recalculation
<motion.div
  animate={{ scaleX: isOpen ? 1 : 0 }}
  style={{ transformOrigin: "left", width: 320 }}
/>
```

For a growing/shrinking panel where you genuinely need width to change (not just visually scale), animate `flex-basis` or use a wrapper with `overflow: hidden` and animate the inner content's `transform: translateX`, never the container's raw `width`.

---

## 2. One Global Motion Token System (no ad-hoc durations anywhere)

Every animation in the app pulls from the same small set of tokens — this is what makes a dozen different micro-interactions feel like one coherent product instead of a grab-bag of effects.

```ts
// lib/motion.ts
export const motionTokens = {
  duration: {
    instant: 0.1,   // press feedback
    fast: 0.15,     // hover states, small UI toggles
    base: 0.2,      // default transitions
    slow: 0.3,       // modals, sheets, page transitions
  },
  spring: {
    snappy: { type: "spring", stiffness: 500, damping: 30 },  // buttons, reactions
    smooth: { type: "spring", stiffness: 300, damping: 30 },  // messages, cards
    gentle: { type: "spring", stiffness: 200, damping: 25 },  // large sheets, modals
  },
  ease: {
    enter: [0.16, 1, 0.3, 1],   // ease-out — entering elements decelerate
    exit: [0.7, 0, 0.84, 0],     // ease-in — exiting elements accelerate
  },
} as const;

// exit animations are always ~60-70% of the enter duration — feels responsive, never sluggish
export const exitDuration = (enter: number) => enter * 0.65;
```

Import this everywhere instead of writing `{ duration: 0.234 }` inline — one source of truth means changing the "feel" of the whole app later is a one-line edit, not a find-and-replace across 40 components.

---

## 3. Respect the Frame Budget (16ms rule)

60fps = 16.6ms per frame. Anything heavier than that on the main thread causes visible stutter, especially during scroll or while messages stream in over the WebSocket.

- **Never** run JSON parsing, date formatting, or markdown/emoji parsing inline during render for a scrolling list — precompute it once when the message arrives (in the WS handler, not in the render function), store the formatted result, and render from that.
- Debounce/throttle high-frequency events:
```ts
// hooks/useThrottledTyping.ts — the composer only pings /ws "typing" at most every 2s,
// not on every keystroke, even though the UI feels instant to the user typing
const throttledSendTyping = useMemo(() => throttle(sendTypingEvent, 2000), []);
```
- Scroll position tracking (e.g. "show scroll-to-bottom FAB") must use a throttled/passive scroll listener, never an unthrottled one:
```ts
useEffect(() => {
  const handler = throttle(() => setShowFAB(!isNearBottom()), 100);
  el.addEventListener("scroll", handler, { passive: true });
  return () => el.removeEventListener("scroll", handler);
}, []);
```

---

## 4. Virtualize Every Long List

Chat threads, chat lists, and friend lists can all exceed the 50-item threshold where un-virtualized rendering starts costing real memory and scroll performance.

```tsx
// components/chat/MessageList.tsx
import { Virtuoso } from "react-virtuoso";

<Virtuoso
  data={messages}
  followOutput="smooth"              // auto-scrolls to new messages smoothly, not a hard jump
  itemContent={(index, message) => <MessageBubble message={message} />}
  increaseViewportBy={{ top: 400, bottom: 200 }}  // pre-renders just outside viewport so scroll never shows blank frames
/>
```
Only the ~15–20 messages actually near the viewport exist in the DOM at once, no matter how long the conversation history is. This is the single biggest performance lever in the whole app — a non-virtualized 2,000-message thread will feel sluggish no matter how well-tuned the individual animations are.

---

## 5. Next.js Rendering Strategy (what runs where)

| Layer | Rendering | Why |
|---|---|---|
| Chat list shell, static profile fields | **Server Component** | Zero client JS for content that doesn't need interactivity; fastest possible first paint |
| Message thread, composer, reactions, call UI | **Client Component**, code-split | Needs WebSocket + Framer Motion; loaded only when that route is visited |
| Landing/marketing pages | **Static Generation (SSG)** | Pre-rendered at build time, served instantly from the edge |
| Status feed, friend list | Server Component shell + client-side revalidation via TanStack Query | Fast initial paint, live-updates after |

```tsx
// app/(app)/chats/[chatId]/page.tsx
import dynamic from "next/dynamic";

// Heavy client-only pieces are code-split so the initial route JS stays small
const MessageThread = dynamic(() => import("@/components/chat/MessageThread"), {
  loading: () => <ThreadSkeleton />,
  ssr: false,
});
const CallOverlay = dynamic(() => import("@/components/calls/CallScreen"), { ssr: false });
```

- Route-level code splitting is automatic in the App Router — the call-screen, video, and LiveKit SDK bundles should never be in the initial bundle for someone just opening a chat to read messages.
- `next/dynamic` with `ssr: false` for anything that touches `window`, WebRTC, or browser-only storage.

---

## 6. Perceived Speed: Optimistic UI + Skeletons

The backend is realtime, but network round-trips still exist — perceived speed comes from never making the user wait to *see* a result, even if the server confirmation arrives 100ms later.

- **Sending a message:** render it immediately in the thread (optimistic), grey/60% opacity + small clock icon, swap to full opacity + delivered tick the instant `message.ack` arrives over WS. If it fails, the bubble shows a retry affordance in place — never silently disappears.
- **Reactions:** apply the emoji to local state instantly on tap, reconcile with the server response in the background; roll back only on an actual error.
- **Skeleton screens, not spinners,** for anything expected to take >300ms (opening a chat, loading the status feed) — a skeleton preserves layout (zero CLS) and reads as "already loading the real thing," while a centered spinner reads as "stopped, waiting."
```tsx
// components/chat/ThreadSkeleton.tsx — shaped like real bubbles, shimmer via CSS animation, not JS
<div className="animate-pulse space-y-3 p-4">
  {[60, 40, 75, 30].map((w, i) => (
    <div key={i} className={`h-10 rounded-2xl bg-surface-elevated`} style={{ width: `${w}%`, marginLeft: i % 2 ? "auto" : 0 }} />
  ))}
</div>
```
- **Prefetch on hover/focus:** `<Link prefetch>` (default in Next.js App Router) plus prefetching a chat's first page of messages via TanStack Query's `queryClient.prefetchQuery` when a chat-list row is hovered/focused — by the time the tap lands, the data is often already there.

---

## 7. Images & Media (avatars, Status photos/videos, attachments)

- Always `next/image`, always explicit `width`/`height` (or `fill` with a sized parent) — this is the single most common cause of layout shift (CLS) in chat apps, where avatar/thumbnail dimensions load after the surrounding text.
- Avatars and thumbnails served at the exact display size via the image loader's resize params — never ship a 2MB original into a 40px circle.
- Status video: show the poster-frame image instantly, load/decode the video only once it's the active item in the viewer, pause/unload it the moment it's swiped away — never run more than one video decoder at a time.
- Blur-up placeholder (`placeholder="blur"` with a tiny base64 blurDataURL, generated server-side at upload time by the Celery thumbnail job) so images feel like they materialize into focus instead of popping in.

---

## 8. Font Loading

```tsx
// app/layout.tsx
import { Inter } from "next/font/google";
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
```
`next/font` self-hosts and inlines font files with zero layout shift and no render-blocking request to Google Fonts — use it for both Inter (body) and the display headline font, never a `<link>` tag to an external font host.

---

## 9. WebSocket-Driven Updates Instead of Polling

Nothing should poll. Every "live" piece of UI (presence, typing, unread counts, status views/reactions, call state) updates from the single multiplexed WebSocket connection already defined in your backend — polling a REST endpoint every few seconds is both slower to reflect reality and wasteful of battery/bandwidth compared to a pushed event.

```ts
// store/socketStore.ts — one connection, fan out to whichever component cares
socket.on("message.new", (msg) => queryClient.setQueryData(["messages", msg.chatId], (old) => [...old, msg]));
socket.on("presence", (p) => presenceStore.update(p.userId, p.state));
```
Update the relevant slice of local/cache state directly from the event — never trigger a full refetch of a list just because one item in it changed.

---

## 10. Reduced Motion Is Not Optional

```ts
// hooks/useMotionSafe.ts (from FRONTEND-DESIGN-SYSTEM.md, reproduced here as the perf/accessibility baseline)
const reduce = useReducedMotion();
```
Every custom animation in the app must check this and fall back to an instant or opacity-only transition. This isn't just accessibility — it's also a perf escape hatch for low-end devices where `prefers-reduced-motion` is often set by the OS automatically under battery-saver conditions.

---

## 11. Performance Budget & Monitoring

| Metric | Target |
|---|---|
| LCP (Largest Contentful Paint) | < 2.0s |
| INP (Interaction to Next Paint) | < 150ms |
| CLS (Cumulative Layout Shift) | < 0.05 |
| Main-thread work per animation frame | < 16ms |
| Initial route JS (chat list route) | < 150KB gzipped |
| Time to first message visible after opening a chat | < 300ms (cache hit) |

```tsx
// app/layout.tsx — report real-user Core Web Vitals
export function reportWebVitals(metric) {
  if (metric.label === "web-vital") {
    // send to your analytics/monitoring endpoint
  }
}
```
Run Lighthouse (or `next build && next start` + WebPageTest) before every release on the chat-thread route specifically — it's the most animation-and-data-heavy screen and the one most likely to regress silently as features get added.

---

## 12. Quick Checklist Before Shipping Any New Screen

- [ ] Every animation uses `transform`/`opacity` only
- [ ] Durations/springs pulled from `lib/motion.ts`, nothing hardcoded inline
- [ ] Lists over ~50 items are virtualized
- [ ] Images have explicit dimensions and use `next/image`
- [ ] Anything client-only (WebRTC, WS, browser storage) is `dynamic(..., { ssr: false })` and code-split off the initial bundle
- [ ] Loading states >300ms show a layout-matched skeleton, not a spinner
- [ ] Mutations (send, react, friend request) update the UI optimistically before the server responds
- [ ] `useReducedMotion()` guards every custom animation
- [ ] No polling — every live update comes from the WebSocket
- [ ] Checked against the budget table in §11
