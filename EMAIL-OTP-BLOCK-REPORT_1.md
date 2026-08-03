# TALK CONNECT — Email OTP Verification + Block, Report & Unblock

Two features for Cursor to implement, building on the existing `User`, `Friendship`, and `Block` models from `BACKEND-AUTH-REALTIME-STATUS.md`.

---

## 1. Email OTP Verification

When a user signs up, send a 6-digit one-time code to their email; they must enter it before their account is fully active.

### 1.1 Flow
1. `POST /auth/register` creates the `User` row with `is_verified = false`, generates a 6-digit OTP, hashes it, stores it with a short expiry, and sends it by email.
2. User enters the code on a verification screen → `POST /auth/verify-email`.
3. On match, `is_verified` flips to `true`. Access/refresh tokens are issued **here**, not at registration — an unverified account shouldn't be usable yet.
4. If the code expires or is lost, `POST /auth/resend-otp` generates and sends a new one (rate-limited).

### 1.2 Data
```
EmailOTP   id, user_id, code_hash, purpose (enum: signup/password_reset/login_2fa),
           expires_at (created_at + 10 minutes), attempts (int, default 0), consumed (bool)
```
Never store the OTP in plain text — hash it the same way you'd hash a short password (bcrypt or even a simple HMAC with a server secret is fine for a 6-digit code with a short expiry and attempt limit).

### 1.3 Endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create user (`is_verified=false`), generate + email OTP, **no tokens issued** |
| POST | `/auth/verify-email` | `{ email, code }` → validate → mark verified → issue access + refresh tokens |
| POST | `/auth/resend-otp` | `{ email }` → invalidate any unconsumed OTP, generate + send a new one |

### 1.4 Backend logic
```python
# services/otp_service.py
import random, hashlib
from datetime import datetime, timedelta

def generate_otp() -> str:
    return f"{random.randint(0, 999999):06d}"

def hash_otp(code: str, secret: str) -> str:
    return hashlib.sha256(f"{code}{secret}".encode()).hexdigest()

async def create_and_send_otp(db, email: str, user_id: str, purpose: str):
    code = generate_otp()
    otp = EmailOTP(
        user_id=user_id,
        code_hash=hash_otp(code, settings.otp_secret),
        purpose=purpose,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
    )
    db.add(otp)
    await db.commit()
    await email_service.send_otp_email(to=email, code=code)  # the only place the raw code exists outside the user's inbox

async def verify_otp(db, user_id: str, code: str, purpose: str) -> bool:
    otp = await get_latest_unconsumed_otp(db, user_id, purpose)
    if not otp or otp.expires_at < datetime.utcnow():
        return False
    if otp.attempts >= 5:
        return False  # locked out — force a resend instead of allowing brute force on a 6-digit code
    otp.attempts += 1
    if otp.code_hash != hash_otp(code, settings.otp_secret):
        await db.commit()
        return False
    otp.consumed = True
    await db.commit()
    return True
```

### 1.5 Sending the email
Use a transactional email provider (Resend, SendGrid, or AWS SES) — never send email directly from the API process with raw SMTP in production.

```python
# services/email_service.py
import resend
resend.api_key = settings.resend_api_key

async def send_otp_email(to: str, code: str):
    resend.Emails.send({
        "from": "Talk Connect <verify@talkconnect.com>",   # replace with your actual verified sending domain
        "to": to,
        "subject": f"{code} is your Talk Connect verification code",
        "html": render_otp_email_template(code),
    })
```
- Verify your sending domain (SPF/DKIM records) with whichever provider you pick, or emails will land in spam.
- Keep the email itself simple: large code, one line explaining it expires in 10 minutes, no unnecessary marketing content — transactional emails with a clean, minimal template have meaningfully better deliverability and trust than heavily styled ones.

### 1.6 Rate limiting & abuse prevention
- `/auth/resend-otp`: max 3 sends per email per 15 minutes (Redis counter) — prevents using your app as a free email-bombing tool against someone else's inbox.
- OTP attempts capped at 5 per code (§1.4) before requiring a fresh resend.
- Registration itself should also be rate-limited per IP to prevent mass fake-account creation.

### 1.7 Frontend
- After the register form submits successfully, transition (don't navigate to a new page — slide/crossfade, consistent with `FRONTEND-DESIGN-SYSTEM.md §3.1`) into a 6-digit OTP input.
- Auto-focus first box, auto-advance between boxes, auto-submit when all 6 are filled.
- "Resend code" link, disabled with a visible countdown (e.g. 60s) between allowed resends.
- Clear inline error ("Code expired, request a new one" / "Incorrect code, 3 attempts left") rather than a generic failure message.

---

## 2. Block, Report & Unblock

Builds on the `Block` model already defined in `BACKEND-AUTH-REALTIME-STATUS.md §5`; this section adds **Report** and fills in the full request/response contract.

### 2.1 Data
```
Block     blocker_id, blocked_id, created_at              # already defined — unique (blocker_id, blocked_id)
Report    id, reporter_id, reported_user_id, reason (enum: spam/harassment/inappropriate_content/impersonation/other),
          details (text, optional), status (enum: pending/reviewed/action_taken/dismissed),
          created_at, reviewed_at (nullable), reviewed_by (nullable, admin user id)
```

### 2.2 Endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/friends/{user_id}/block` | Block a user — also auto-unfriends if currently friends, removes them from search results, blocks messages/calls/status visibility both directions |
| DELETE | `/friends/{user_id}/block` | Unblock — restores normal visibility, but does **not** auto-restore the friendship; they'd need to re-send a friend request |
| GET | `/friends/blocked` | List currently blocked users, for the "Blocked Contacts" settings screen |
| POST | `/users/{user_id}/report` | `{ reason, details? }` → creates a `Report` row; does not require blocking at the same time, though the UI should offer both as one combined action |
| GET | `/admin/reports?status=pending` | Admin-only: list pending reports for review (only needed once you have a moderation surface — stub it now, build the review UI later) |

### 2.3 Backend behavior
```python
# services/friend_service.py
async def block_user(db, blocker_id: str, blocked_id: str):
    # remove any existing friendship both directions
    await delete_friendship_if_exists(db, blocker_id, blocked_id)
    # cancel any pending friend requests either direction
    await cancel_pending_requests(db, blocker_id, blocked_id)
    block = Block(blocker_id=blocker_id, blocked_id=blocked_id)
    db.add(block)
    await db.commit()

async def report_user(db, reporter_id: str, reported_user_id: str, reason: str, details: str | None):
    report = Report(reporter_id=reporter_id, reported_user_id=reported_user_id, reason=reason, details=details)
    db.add(report)
    await db.commit()
    # optional: auto-flag for priority review if this user has multiple recent reports
    recent_count = await count_recent_reports(db, reported_user_id, days=30)
    if recent_count >= 3:
        await flag_user_for_review(db, reported_user_id)
```

A `Block` check must be applied as a fast guard in **every** relevant authorization dependency — messaging, calling, viewing status, friend requests, search visibility — checked before the more expensive Friendship/ChatMember lookups, ideally via a Redis-cached set (`SISMEMBER blocked:{user_id} {other_user_id}`) so it doesn't add latency to every hot-path request.

### 2.4 Frontend
- **Block/Report entry points:** on a user's profile (overflow menu), and on a long-press of any message from them in a chat.
- **Combined flow:** tapping "Report" opens a bottom sheet with reason options (radio list) + optional free-text details, and a checkbox "Also block this person" (checked by default) — most users reporting someone also want them blocked immediately, so make that the default rather than a separate step.
- **Blocked Contacts screen** (Settings): flat, deliberately unstyled list per `FRONTEND-DESIGN-SYSTEM.md §3.5` — no gradients or motion here, each row has a plain "Unblock" button with a confirmation step ("Unblock Sarah? They won't be notified.").
- After blocking, immediately remove that user's messages from view in any shared chat (or replace with a neutral "This contact is blocked" placeholder) without needing a page refresh — update local cache state right away, don't wait for a refetch.

---

## 3. Cursor Task List

```
1. Add EmailOTP and Report models + Alembic migration.
2. Wire up a transactional email provider (Resend or SendGrid) using an API key from environment variables only.
3. Implement POST /auth/register (no tokens issued), POST /auth/verify-email (issues tokens), POST /auth/resend-otp, with rate limiting on resend.
4. Update the frontend signup flow: form -> OTP entry screen (same page, animated transition) -> redirect into the app on success.
5. Implement POST/DELETE /friends/{user_id}/block, GET /friends/blocked, POST /users/{user_id}/report.
6. Add a Block-check guard to the authorization dependencies for messaging, calling, status visibility, and search — verify it actually prevents a blocked user from messaging, not just from showing in search.
7. Build the frontend Block/Report bottom sheet and the Blocked Contacts settings screen.
8. Test end-to-end: register a new account, receive and enter the real OTP email, confirm the account activates; then block a second test user and confirm they can no longer message, call, or find the blocking user, and confirm unblock restores visibility.
```
