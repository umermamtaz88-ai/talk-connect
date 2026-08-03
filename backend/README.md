# TALK CONNECT — Backend

FastAPI backend for the TALK CONNECT messenger: auth, friends, chats, realtime messaging, Status/Stories, LiveKit-ready calls, and Vault large-file transfer.

## Quick start

```powershell
# Requires: Python 3.14+, uv
uv sync
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

| Resource | URL |
|---|---|
| API | http://127.0.0.1:8000 |
| Interactive docs (Swagger) | http://127.0.0.1:8000/docs |
| ReDoc | http://127.0.0.1:8000/redoc |
| Health | http://127.0.0.1:8000/health |

Full reference: **[DOCUMENTATION.md](./DOCUMENTATION.md)**

## Stack

- **FastAPI** + **Uvicorn**
- **SQLAlchemy** async (SQLite by default; Postgres/Neon via `DATABASE_URL`)
- **JWT** access tokens + httpOnly refresh cookies
- **Redis** for presence / pub-sub (in-memory fallback if Redis is down)
- **bcrypt** passwords, **pyotp** for 2FA
- **uv** for dependency management

## Project layout

```
src/backend/
  main.py              # App entry, lifespan, router mounts
  api/                 # HTTP + WebSocket routes
  core/                # Config, DB, security, deps, Redis
  models/              # SQLAlchemy models
  schemas/             # Pydantic request/response models
  services/            # Business logic
```

## Auth flow (minimal)

1. `POST /auth/register` → receive `verification_code` (dev only)
2. `POST /auth/verify` with email + code
3. `POST /auth/login` → `access_token` + `refresh_token` cookie
4. Send `Authorization: Bearer <access_token>` on protected routes
5. Connect realtime: `ws://127.0.0.1:8000/ws?token=<access_token>`

## Environment

Copy `.env` (already git-ignored). Important keys:

```
SECRET_KEY=...
DATABASE_URL=sqlite+aiosqlite:///./talkconnect.db
REDIS_URL=redis://localhost:6379/0
DEBUG=true
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

See [DOCUMENTATION.md](./DOCUMENTATION.md) for the complete env table, API catalogue, WebSocket events, and data model.
