from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any
from uuid import uuid4

import bcrypt
import jwt

from backend.core.config import get_settings

settings = get_settings()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(rounds=settings.bcrypt_rounds),
    ).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: str, *, jti: str | None = None) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
        "jti": jti or str(uuid4()),
        "type": "access",
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def create_refresh_token(user_id: str, *, jti: str | None = None) -> tuple[str, str, datetime]:
    now = datetime.now(UTC)
    token_jti = jti or str(uuid4())
    expires = now + timedelta(days=settings.refresh_token_days)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": expires,
        "jti": token_jti,
        "type": "refresh",
    }
    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token, token_jti, expires


def decode_token(token: str, *, expected_type: str | None = None) -> dict[str, Any]:
    payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    if expected_type and payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload


def hash_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def verify_token_hash(token: str, token_hash: str) -> bool:
    return hash_token(token) == token_hash
