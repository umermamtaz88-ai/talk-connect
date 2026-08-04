# TALK CONNECT — FastAPI Cloud Commands & Deployment Debug (for Cursor)

Reference for deploying/managing the backend on FastAPI Cloud, plus a ready-to-paste Cursor prompt for the current "Verification Failed" deployment issue.

---

## 1. Setup & Deploy

```bash
# Install (comes bundled with FastAPI's standard install)
pip install "fastapi[standard]"

# Log in — opens your browser to authenticate
fastapi login

# Deploy from your project root (auto-detects your app)
fastapi deploy
# same as: fastapi cloud deploy
```

## 2. Debugging a Failed/Broken Deployment

```bash
# Check who you're logged in as
fastapi cloud whoami

# Stream build + runtime logs — this is what tells you WHY verification failed
fastapi cloud logs
```

## 3. Environment Variables

```bash
# List current env vars
fastapi cloud env list

# Set one (prompts for hidden input if you omit the value)
fastapi cloud env set DATABASE_URL
fastapi cloud env set JWT_SECRET

# Delete one
fastapi cloud env delete OLD_VAR_NAME
```
⚠️ Setting an env var does **not** auto-redeploy — run `fastapi deploy` again after changing any of them.

## 4. CI/CD (auto-deploy on push to main)

```bash
fastapi cloud setup-ci
```

## 5. Relink a Local Project

```bash
fastapi unlink    # removes local .fastapicloud config, lets you relink/redeploy as fresh
```

---

## 6. Current Issue: "Verification Failed"

Deployment: *"Speed up frontend auth hydrate with shorter timeouts"* — build succeeded, but post-deploy verification failed. This means the app started but didn't respond correctly to the platform's health check; the real cause is only visible in the runtime logs, not the build logs or the dashboard summary.

### Cursor Prompt (paste this whole block)

```
My FastAPI Cloud deployment shows "Verification Failed" on a commit titled
"Speed up frontend auth hydrate with shorter timeouts."

Run these commands and show me the full output of each:
1. fastapi cloud logs
2. fastapi cloud env list

From the logs, find the actual runtime error or the exact endpoint the health
check is hitting that's failing — "Verification Failed" means the build
succeeded but the app didn't respond correctly once running.

Given the commit is about shortening an auth-related timeout, specifically check:
- Any AbortController or fetch timeout value that was shortened in this commit —
  is it now shorter than the time the health-check endpoint or a cold Neon DB
  connection actually takes to respond?
- Whether a shortened timeout now throws an unhandled error/promise rejection
  instead of failing gracefully, which could crash the request instead of
  returning a normal error response
- Whether any environment variable this timeout logic depends on is set
  locally but missing from `fastapi cloud env list`

Once you find the root cause, fix it, then redeploy with `fastapi deploy` and
confirm the deployment shows successful verification, not just a successful build.
```

---

## 7. Keeping Frontend (Vercel) ↔ Backend (FastAPI Cloud) Reliably Connected

### CORS — backend must explicitly allow the Vercel domain
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://talkconnect.vercel.app", "https://your-custom-domain.com"],
    allow_credentials=True,   # required for httpOnly refresh-token cookies
    allow_methods=["*"],
    allow_headers=["*"],
)
```
`allow_origins=["*"]` silently breaks anything using credentials/cookies.

### Frontend env vars
```
NEXT_PUBLIC_API_URL=https://yourapp.fastapicloud.dev
NEXT_PUBLIC_WS_URL=wss://yourapp.fastapicloud.dev/ws
```

### Client-side WebSocket reconnect (exponential backoff)
```ts
// hooks/useSocket.ts
function connect() {
  const ws = new WebSocket(`${WS_URL}?token=${accessToken}`);
  ws.onclose = () => {
    const delay = Math.min(1000 * 2 ** attempt, 30000); // capped at 30s
    setTimeout(connect, delay);
    attempt++;
  };
  ws.onopen = () => { attempt = 0; resyncMissedEvents(); };
}
```

### Heartbeat (catches "half-dead" connections)
```ts
setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 25000);
```
If no `pong` returns within a few seconds, force-close and let the reconnect logic above handle it.

### Health-check endpoint
```python
@app.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT 1"))  # confirms DB is reachable, not just that the process is running
    return {"status": "ok"}
```

### Idle/cold-start safety net
- Point an uptime monitor (e.g. UptimeRobot) at `/health` every 5 minutes.
- Keep `pool_pre_ping=True` on the DB engine so a stale/cold Neon connection is detected and retried instead of erroring on the first request after idle time.

---

## 8. Quick Checklist

- [ ] `fastapi cloud logs` checked for the real runtime error before guessing
- [ ] `fastapi cloud env list` matches what the app actually needs (compare against `.env.example`)
- [ ] CORS origins list matches the exact deployed Vercel URL(s)
- [ ] `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` point at the live FastAPI Cloud URL, `wss://` not `ws://`
- [ ] WebSocket client has reconnect + heartbeat logic, not a single unrecovered connection attempt
- [ ] `/health` endpoint exists and actually touches the DB, not just returns a static 200
- [ ] Redeployed with `fastapi deploy` after any env var change
