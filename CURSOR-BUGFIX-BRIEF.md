# TALK CONNECT — Bug Fix Brief for Cursor

Paste this whole file into Cursor (Composer/Agent mode) as one task. Go through each section in order — later sections depend on earlier ones working (you can't test messaging if login is broken, and you can't test login if the database isn't connected).

Credentials have already been rotated and are stored in `.env` — do not hardcode any connection string or API key anywhere in source files; always read from environment variables via the settings/config module.

---

## Context

This is TALK CONNECT, a FastAPI + Next.js real-time chat app backed by Neon Postgres. It currently has these problems:
1. The database isn't connecting.
2. The signup ("Create Account") button doesn't work correctly.
3. Login doesn't work correctly.
4. Users are visible in the app but can't actually be messaged — the message/add button doesn't do anything.

Fix these four things first, in this order, verifying each one actually works before moving to the next. Then add the two features described in §5 and §6.

---

## 1. Fix the Database Connection First

**Do this before touching anything else** — none of the other bugs can be reliably tested while the DB connection is broken.

1. Open the database config/session file. Confirm the connection string is read only from an environment variable (e.g. `settings.database_url`), never hardcoded.
2. Check the connection string format. If it currently looks like:
   ```
   postgresql://user:pass@host/db?sslmode=require&channel_binding=require
   ```
   convert it for SQLAlchemy's async `asyncpg` driver to:
   ```
   postgresql+asyncpg://user:pass@host/db?ssl=require
   ```
   `asyncpg` does not understand `sslmode` or `channel_binding` as query parameters — this alone is a likely cause of the connection failure.
3. In the async engine setup, add `pool_pre_ping=True` so a suspended/stale Neon connection is detected and retried automatically instead of throwing an error on the first request after idle time.
4. If using Neon's pooled connection string (the one with `-pooler` in the hostname) for the main app, use Neon's **direct** (non-pooled) connection string for Alembic migrations specifically — get it from the Neon dashboard by toggling "Pooled connection" off. Put it in a separate `MIGRATIONS_DATABASE_URL` env var and point `alembic.ini`/`env.py` at that one.
5. Search the entire repo for any other hardcoded `postgresql://` or `neon.tech` string and delete it — there should be exactly one source of truth.
6. Verify the fix by running the migrations and confirming tables actually appear in the Neon dashboard's table browser:
   ```
   alembic upgrade head
   ```
7. Start the backend and hit a simple endpoint that touches the DB (e.g. a health-check route that runs `SELECT 1`) to confirm the connection works end-to-end before moving on.

---

## 2. Fix Signup ("Create Account" Button)

1. Open the signup form component. Confirm the submit button is `type="submit"` inside a `<form onSubmit={handleSubmit(onSubmit)}>` (or the exact equivalent for whatever form library is in use) — not a bare `<div onClick>` or a button with no handler at all.
2. Add a temporary `console.log("submit fired", data)` as the first line inside the submit handler and click the button — confirm in the browser console whether it fires at all.
   - **If it never fires:** the handler isn't wired up, or the button is disabled by a validation state that's stuck false. Fix the wiring/validation logic directly.
   - **If it fires but nothing happens after:** check the Network tab for the actual `/auth/register` request — what status code comes back?
3. If the request never appears in the Network tab at all, check `NEXT_PUBLIC_API_URL` is set correctly for the current environment (local vs. deployed) — a wrong or missing value causes requests to silently fail or hit the wrong host.
4. If the request appears but fails with a CORS error in the console (not a normal HTTP error), fix the backend's `CORSMiddleware` to explicitly include the frontend's exact origin (not `"*"`).
5. If the request returns 422, log and inspect the request payload vs. what the `/auth/register` Pydantic schema expects — field name mismatches (e.g. `username` vs. `userName`) are a common cause.
6. Add real error handling: on failure, capture the error and display it near the button instead of failing silently. On success, redirect to the verification/login flow.
7. Test end-to-end: create a brand-new account through the UI and confirm the `User` row actually appears in the Neon database.

---

## 3. Fix Login

1. Repeat the same debugging approach as §2 (console.log in the handler, check Network tab, check payload shape).
2. Test `/auth/login` directly with curl or Postman first, independent of the frontend, using the account created in §2 — this isolates whether the bug is backend or frontend.
3. If curl/Postman works but the browser doesn't: check that every authenticated fetch call includes `credentials: "include"`, and that the backend's CORS config has `allow_credentials=True` with an explicit origin — `allow_credentials=True` combined with `allow_origins=["*"]` is invalid and browsers will reject it.
4. If curl/Postman also fails with the correct password: check the password hashing/verification code path directly — confirm `verify_password(plain, hashed)` is being called with the arguments in the right order, and that the hash stored at registration time actually used the same hashing function being used to verify.
5. Confirm the access token returned by a successful login is actually stored (state/memory, not localStorage) and is attached as `Authorization: Bearer <token>` on the very next authenticated request — a common bug is receiving the token but never using it afterward.
6. Test end-to-end: log in with the account from §2, then call `/auth/me` and confirm it returns that same user's data.

---

## 4. Fix "Users Visible But Not Messageable" / Add Button Not Working

1. Click the message/add button on a user's profile or search result and check the Network tab: does any request fire at all?
   - **No request fires:** the button has no `onClick` handler wired — likely leftover from an early static UI mockup. Wire it to actually call the chat-creation endpoint.
   - **Request fires, returns 403:** authorization is correctly blocking the action (e.g. a "must be friends to message" rule). Decide whether that's the intended behavior. If so, change the button's label/behavior to "Add Friend" instead of "Message" for non-friends, so the UI matches the actual rule instead of looking broken. If not intended, relax the authorization check.
   - **Request fires, returns 404:** the frontend is likely trying to send a message to a `chat_id` that doesn't exist yet. Implement (or fix) a find-or-create pattern: calling the "start chat" endpoint with a target user ID should return an existing 1:1 chat if one already exists between these two users, or create a new one, and always return a valid `chat.id`.
   - **Request succeeds but nothing visibly happens:** after a successful chat creation, the frontend needs to navigate to that chat (e.g. `router.push(`/chats/${chat.id}`)`) and refresh/invalidate the chat list — right now it likely succeeds silently with no UI update.
2. Add a disabled/loading state to the button while the request is in flight, so rapid double-clicks can't create duplicate chats.
3. Test end-to-end: from a fresh account, find another user, click the button, and confirm you land in a working chat thread that can actually send and receive a message.

---

## 5. New Feature: AI Chat Assistant

Do this only after §1–4 are confirmed working.

1. Add a new backend endpoint `POST /ai/chat` that accepts `{ message, conversationId? }`, calls the LLM provider **server-side only** using an API key read from an environment variable, and streams the response back (Server-Sent Events or a chunked HTTP response) — the frontend must never see or call the LLM provider directly, since that would expose the API key in the browser.
2. Store AI conversation history in its own table(s), separate from regular chat messages, so it doesn't mix with real user-to-user data.
3. Rate-limit this endpoint per user, since it has a real per-call cost unlike the rest of the API.
4. On the frontend, add a pinned "Talk Connect AI" entry at the top of the chat list, visually distinct from real contacts, reusing the existing message-list/composer UI but pointed at the new streaming endpoint instead of the WebSocket.
5. Render the streamed response token-by-token as it arrives so it reads as "typing," not a sudden full dump of text.

---

## 6. New Feature: Tap-to-Translate Messages

1. Add a backend endpoint `POST /messages/{message_id}/translate` with `{ targetLanguage }` that calls a translation API and returns the translated text. Cache results (by `message_id` + `targetLanguage`) so the same message translated by multiple people into the same language only costs one API call.
2. Add a per-chat setting (e.g. `autoTranslateLanguage`, nullable) so a user can optionally have every incoming message in a specific chat auto-translated as it arrives, instead of tapping every time.
3. On the frontend, add a translate icon that appears on long-press/hover of a message bubble. Tapping it opens a language picker; the translated text renders **below** the original with a small "Translated from X" caption and a "Show original" toggle — never replace the original text outright.
4. Add the auto-translate toggle to the chat's info/settings panel.

---

## Final Verification Checklist

Before considering this done, confirm all of the following work end-to-end, in a real browser, not just via curl:

- [ ] Database connects reliably, including after a period of idle time (Neon cold start)
- [ ] A brand-new account can be created through the UI
- [ ] That account can log in through the UI
- [ ] The logged-in user can find another user and start a real message thread with them
- [ ] Messages actually send and appear for both users in real time
- [ ] The AI chat assistant responds to a message
- [ ] Tapping the translate icon on a message returns a translated version
- [ ] No API keys or database credentials appear anywhere in the committed source code — only in `.env`, which is git-ignored
