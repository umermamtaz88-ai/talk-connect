import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from backend.api import ai, auth, calls_vault, chats, friends, location, media, messages, status, users, ws
from backend.core.config import get_settings
from backend.core.database import AsyncSessionLocal, init_db, warm_db
from backend.core.redis_client import redis_manager
from backend.models.vault import AvatarIcon
from backend.services import status_service

settings = get_settings()
logger = logging.getLogger("talkconnect")

PRESET_ICONS = [
    {"style": "gradient-initials", "label": "Aurora", "config": {"gradient": "aurora"}, "preview_url": None},
    {"style": "gradient-initials", "label": "Sunset", "config": {"gradient": "sunset"}, "preview_url": None},
    {"style": "gradient-initials", "label": "Ocean", "config": {"gradient": "ocean"}, "preview_url": None},
    {"style": "abstract-shape", "label": "Pulse", "config": {"shape": "pulse"}, "preview_url": None},
    {"style": "abstract-shape", "label": "Orbit", "config": {"shape": "orbit"}, "preview_url": None},
    {"style": "character", "label": "Spark", "config": {"character": "spark"}, "preview_url": None},
]


async def _seed_avatar_icons() -> None:
    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(AvatarIcon).limit(1))
        if existing:
            return
        for item in PRESET_ICONS:
            db.add(
                AvatarIcon(
                    style=item["style"],
                    label=item["label"],
                    config=json.dumps(item["config"]),
                    preview_url=item["preview_url"],
                )
            )
        await db.commit()


async def _status_expiry_loop(stop: asyncio.Event) -> None:
    from backend.services import location_service

    while not stop.is_set():
        try:
            async with AsyncSessionLocal() as db:
                count = await status_service.expire_old_statuses(db)
                loc_count = await location_service.expire_old_shares(db)
                await db.commit()
                if count:
                    logger.info("Expired %s status posts", count)
                if loc_count:
                    logger.info("Expired %s live location shares", loc_count)
        except Exception:
            logger.exception("Expiry sweep failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except TimeoutError:
            continue


async def _db_keepalive_loop(stop: asyncio.Event) -> None:
    """Keep Neon compute awake — cold starts were causing multi-second spinners."""
    while not stop.is_set():
        try:
            await warm_db()
        except Exception:
            logger.exception("DB keepalive failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=45)
        except TimeoutError:
            continue


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    try:
        await warm_db()
    except Exception:
        logger.exception("Initial DB warm failed")
    await redis_manager.connect()
    await _seed_avatar_icons()
    stop = asyncio.Event()
    task = asyncio.create_task(_status_expiry_loop(stop))
    keepalive = asyncio.create_task(_db_keepalive_loop(stop))
    yield
    stop.set()
    await task
    await keepalive
    await redis_manager.close()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(friends.router)
app.include_router(status.router)
app.include_router(media.router)
app.include_router(chats.router)
app.include_router(messages.router)
app.include_router(calls_vault.router)
app.include_router(ai.router)
app.include_router(location.router)
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.app_name}


@app.get("/health/db")
async def health_db():
    """Confirm the app can reach Postgres (Neon cold-start safe via pool_pre_ping)."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("SELECT 1"))
            ok = result.scalar() == 1
        return {"status": "ok" if ok else "error", "database": "connected" if ok else "failed"}
    except Exception as exc:
        logger.exception("DB health check failed")
        return {"status": "error", "database": "failed", "detail": str(exc)}
