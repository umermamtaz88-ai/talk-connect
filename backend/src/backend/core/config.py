from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env regardless of process cwd
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def normalize_database_url(url: str) -> str:
    """Convert Neon/libpq URLs to SQLAlchemy asyncpg form."""
    raw = url.strip()
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://") :]
    if raw.startswith("postgresql://") and "+asyncpg" not in raw:
        raw = "postgresql+asyncpg://" + raw[len("postgresql://") :]

    parsed = urlparse(raw)
    # asyncpg does not use libpq sslmode / channel_binding query params
    query = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in {"sslmode", "channel_binding", "ssl"}
    ]
    return urlunparse(parsed._replace(query=urlencode(query)))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "TALK-CONNECT"
    debug: bool = True
    secret_key: str = "dev-secret-change-me-in-production"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    database_url: str = "sqlite+aiosqlite:///./talkconnect.db"
    # Direct (non-pooler) Neon URL for DDL / migrations when set
    migrations_database_url: str = ""
    redis_url: str = "redis://localhost:6379/0"
    bcrypt_rounds: int = 12
    login_max_attempts: int = 5
    login_window_seconds: int = 300
    instance_id: str = "local-1"
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://talkconnect.vercel.app",
        "https://talk-connect-2nec.vercel.app",
        "https://talk-connect-pearl.vercel.app",
    ]
    # Comma-separated extra origins for Vercel preview URLs, etc.
    cors_origins_extra: str = ""
    # When true (typical cloud), cookies use SameSite=None so Vercel can call the API
    cookie_cross_site: bool | None = None
    # LiveKit (optional — stub tokens used when unset)
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    # Media / Vault defaults
    max_attachment_bytes: int = 100 * 1024 * 1024
    vault_chunk_size: int = 5 * 1024 * 1024
    vault_max_bytes: int = 10 * 1024 * 1024 * 1024  # 10GB
    # Optional SMTP — when unset, OTPs are logged + returned in debug responses
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True
    otp_ttl_minutes: int = 10
    otp_secret: str = ""
    # Resend transactional email (preferred over raw SMTP)
    resend_api_key: str = ""
    resend_from: str = "TALK-CONNECT <onboarding@resend.dev>"
    # Gemini (server-side only — never expose to the browser)
    gemini_api_key: str = ""
    llm_model: str = "gemini-flash-latest"
    ai_rate_limit_per_minute: int = 20
    # Admin emails (comma-separated) for report review stub
    admin_emails: str = ""

    @field_validator("database_url", "migrations_database_url", mode="before")
    @classmethod
    def _normalize_db(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            return v
        return normalize_database_url(v)

    def resolved_cors_origins(self) -> list[str]:
        extras = [
            o.strip()
            for o in (self.cors_origins_extra or "").split(",")
            if o.strip()
        ]
        # Preserve order, drop dupes
        seen: set[str] = set()
        out: list[str] = []
        for origin in [*self.cors_origins, *extras]:
            if origin not in seen:
                seen.add(origin)
                out.append(origin)
        return out

    def refresh_cookie_kwargs(self) -> dict:
        """Cookie flags for refresh tokens across Vercel ↔ FastAPI Cloud."""
        cross_site = (
            self.cookie_cross_site
            if self.cookie_cross_site is not None
            else (not self.debug)
        )
        if cross_site:
            return {
                "httponly": True,
                "secure": True,
                "samesite": "none",
                "max_age": self.refresh_token_days * 24 * 3600,
                "path": "/auth",
            }
        return {
            "httponly": True,
            "secure": not self.debug,
            "samesite": "lax",
            "max_age": self.refresh_token_days * 24 * 3600,
            "path": "/auth",
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


def clear_settings_cache() -> None:
    get_settings.cache_clear()
