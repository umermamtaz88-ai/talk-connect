# TALK CONNECT Frontend

Next.js 16 app wired to the FastAPI backend in `DOCUMENTATION.md`, styled per `FRONTEND-DESIGN-SYSTEM.md`.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Backend should be running at `http://127.0.0.1:8000` (see `DOCUMENTATION.md`).

## Env

Copy `.env.local`:

```
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000
```

## What's built

| Area | Routes / components | Backend |
|---|---|---|
| Auth | `/auth` — register → verify → login + 2FA drawer | `POST /auth/*` |
| Chats | `/app` — list + thread + MorphSend | `GET/POST /chats`, messages, WS |
| Status | Feed strip + full-screen viewer | `/status/*` |
| Friends | Friends / Requests / Find tabs | `/friends/*` |
| Settings | Profile, privacy, Focus Sync | `PATCH /users/me`, focus |
| Calls | Incoming overlay + active call UI | `/calls/*`, WS `call.*` |
| Vault | Chunk-grid upload sheet | `/vault/*` |

Design tokens live in `app/globals.css` (Void Indigo, Aurora Pulse, Signal Violet).
