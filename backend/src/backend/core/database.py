from collections.abc import AsyncGenerator
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.core.config import get_settings

settings = get_settings()

_connect_args: dict = {}
# SQL echo adds major latency on every query — never enable on the hot path
_engine_kwargs: dict = {"echo": False}

db_url = settings.database_url
if db_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}
elif "postgresql" in db_url or "asyncpg" in db_url:
    # Neon pooler (PgBouncer) needs SSL + disabled statement cache
    host = urlparse(db_url).hostname or ""
    _connect_args = {"ssl": True, "statement_cache_size": 0}
    _engine_kwargs.update(
        {
            # Detect stale Neon connections after idle; retry instead of failing
            # the first request after cold start.
            "pool_pre_ping": True,
            "pool_size": 5,
            "max_overflow": 5,
            "pool_recycle": 280,
            "pool_timeout": 10,
        }
    )
    if "neon.tech" in host or "pooler" in host:
        _engine_kwargs.update({"pool_size": 5, "max_overflow": 5})

engine = create_async_engine(db_url, connect_args=_connect_args, **_engine_kwargs)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            # Avoid an extra Neon round-trip COMMIT on pure reads
            if session.new or session.dirty or session.deleted:
                await session.commit()
        except Exception:
            await session.rollback()
            raise


async def warm_db() -> None:
    """Touch the pool so the first user request isn't paying Neon wake-up alone."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
        await conn.commit()


async def _sqlite_add_column(conn, table: str, column: str, ddl: str) -> None:
    result = await conn.execute(text(f"PRAGMA table_info({table})"))
    cols = {row[1] for row in result.fetchall()}
    if column not in cols:
        await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


async def _pg_add_column(conn, table: str, column: str, ddl: str) -> None:
    result = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
        ),
        {"t": table, "c": column},
    )
    if result.first() is None:
        await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


async def init_db() -> None:
    from backend import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if settings.database_url.startswith("sqlite"):
            patches = [
                ("users", "status_text", "status_text VARCHAR(160)"),
                ("users", "avatar_type", "avatar_type VARCHAR(16) DEFAULT 'icon'"),
                ("users", "avatar_icon_id", "avatar_icon_id VARCHAR(36)"),
                ("users", "read_receipts_enabled", "read_receipts_enabled BOOLEAN DEFAULT 1"),
                ("users", "typing_indicators_enabled", "typing_indicators_enabled BOOLEAN DEFAULT 1"),
                ("users", "focus_until", "focus_until DATETIME"),
                ("users", "focus_message", "focus_message VARCHAR(200)"),
                ("users", "focus_share_with", "focus_share_with TEXT"),
                ("users", "phone_visibility", "phone_visibility VARCHAR(32) DEFAULT 'friends'"),
                ("users", "findable_by_phone", "findable_by_phone VARCHAR(32) DEFAULT 'everyone'"),
                ("users", "updated_at", "updated_at DATETIME"),
                ("users", "verification_expires_at", "verification_expires_at DATETIME"),
                ("chats", "is_community", "is_community BOOLEAN DEFAULT 0"),
                ("chats", "description", "description VARCHAR(500)"),
                ("chat_members", "auto_translate_language", "auto_translate_language VARCHAR(16)"),
            ]
            for table, col, ddl in patches:
                await _sqlite_add_column(conn, table, col, ddl)
        elif "postgresql" in settings.database_url or "asyncpg" in settings.database_url:
            await _pg_add_column(
                conn,
                "chat_members",
                "auto_translate_language",
                "auto_translate_language VARCHAR(16)",
            )
            # Extend message type enum for location shares (no-op if already present)
            try:
                await conn.execute(text("ALTER TYPE messagetype ADD VALUE IF NOT EXISTS 'location'"))
            except Exception:
                pass
