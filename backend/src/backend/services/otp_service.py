"""Hashed email OTP create / verify / resend."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import get_settings
from backend.models.otp import EmailOTP, OTPPurpose
from backend.models.user import User
from backend.services.email_service import send_otp_email

settings = get_settings()
MAX_ATTEMPTS = 5


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(code: str) -> str:
    secret = settings.otp_secret or settings.secret_key
    return hashlib.sha256(f"{code}{secret}".encode()).hexdigest()


async def invalidate_unconsumed(db: AsyncSession, user_id: str, purpose: OTPPurpose) -> None:
    await db.execute(
        update(EmailOTP)
        .where(
            EmailOTP.user_id == user_id,
            EmailOTP.purpose == purpose,
            EmailOTP.consumed.is_(False),
        )
        .values(consumed=True)
    )


async def create_and_send_otp(
    db: AsyncSession,
    *,
    user: User,
    purpose: OTPPurpose = OTPPurpose.signup,
) -> tuple[str, bool]:
    """Create hashed OTP, email it. Returns (raw_code, emailed)."""
    await invalidate_unconsumed(db, user.id, purpose)
    code = generate_otp()
    ttl = settings.otp_ttl_minutes
    otp = EmailOTP(
        user_id=user.id,
        code_hash=hash_otp(code),
        purpose=purpose,
        expires_at=datetime.now(UTC) + timedelta(minutes=ttl),
        attempts=0,
        consumed=False,
    )
    db.add(otp)
    # Keep legacy columns in sync for any old paths / debugging
    user.verification_code = None
    user.verification_expires_at = otp.expires_at
    await db.flush()
    emailed = await send_otp_email(
        to=user.email,
        code=code,
        display_name=user.display_name,
        ttl_minutes=ttl,
    )
    return code, emailed


async def get_latest_unconsumed(
    db: AsyncSession,
    user_id: str,
    purpose: OTPPurpose,
) -> EmailOTP | None:
    return await db.scalar(
        select(EmailOTP)
        .where(
            EmailOTP.user_id == user_id,
            EmailOTP.purpose == purpose,
            EmailOTP.consumed.is_(False),
        )
        .order_by(EmailOTP.created_at.desc())
        .limit(1)
    )


class OTPVerifyResult:
    def __init__(
        self,
        *,
        ok: bool,
        error: str | None = None,
        attempts_left: int | None = None,
    ):
        self.ok = ok
        self.error = error
        self.attempts_left = attempts_left


async def verify_otp(
    db: AsyncSession,
    *,
    user_id: str,
    code: str,
    purpose: OTPPurpose = OTPPurpose.signup,
) -> OTPVerifyResult:
    digits = "".join(ch for ch in (code or "").strip() if ch.isdigit())
    otp = await get_latest_unconsumed(db, user_id, purpose)
    if not otp:
        return OTPVerifyResult(ok=False, error="No active code. Request a new one.")

    expires = otp.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires < datetime.now(UTC):
        return OTPVerifyResult(ok=False, error="Code expired, request a new one")

    if otp.attempts >= MAX_ATTEMPTS:
        return OTPVerifyResult(
            ok=False,
            error="Too many attempts. Request a new code.",
            attempts_left=0,
        )

    otp.attempts += 1
    await db.flush()

    if otp.code_hash != hash_otp(digits):
        left = MAX_ATTEMPTS - otp.attempts
        return OTPVerifyResult(
            ok=False,
            error=f"Incorrect code, {left} attempt{'s' if left != 1 else ''} left",
            attempts_left=left,
        )

    otp.consumed = True
    await db.flush()
    return OTPVerifyResult(ok=True)
