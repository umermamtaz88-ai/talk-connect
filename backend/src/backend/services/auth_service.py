from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime, timedelta

import pyotp
from fastapi import HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import get_settings
from backend.core.redis_client import rate_limit
from backend.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
    verify_token_hash,
)
from backend.models.device import Device
from backend.models.otp import OTPPurpose
from backend.models.user import User
from backend.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, TotpEnableResponse, UserOut
from backend.services import otp_service

settings = get_settings()
REFRESH_COOKIE = "refresh_token"
logger = logging.getLogger("talkconnect.security")
# Pending 2FA secrets before confirmation (user_id -> secret)
_pending_totp: dict[str, str] = {}


def _phone_hash(phone: str | None) -> str | None:
    if not phone:
        return None
    normalized = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    return hashlib.sha256(normalized.encode()).hexdigest()


async def register(db: AsyncSession, data: RegisterRequest) -> tuple[User, str, bool]:
    """Returns (user, otp_code, emailed). No tokens issued. Re-issues OTP for unverified accounts."""
    email = data.email.lower().strip()
    username = data.username.lower().strip()

    existing = await db.scalar(
        select(User).where((User.email == email) | (User.username == username))
    )
    if existing:
        if existing.email == email and not existing.is_verified:
            if existing.username != username:
                taken = await db.scalar(
                    select(User).where(User.username == username, User.id != existing.id)
                )
                if taken:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Username already taken",
                    )
                existing.username = username
            existing.password_hash = hash_password(data.password)
            existing.display_name = data.display_name.strip()
            code, emailed = await otp_service.create_and_send_otp(
                db, user=existing, purpose=OTPPurpose.signup
            )
            return existing, code, emailed

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email or username already taken",
        )

    user = User(
        username=username,
        email=email,
        phone=data.phone,
        phone_hash=_phone_hash(data.phone),
        password_hash=hash_password(data.password),
        display_name=data.display_name.strip(),
        is_verified=False,
    )
    db.add(user)
    await db.flush()
    code, emailed = await otp_service.create_and_send_otp(
        db, user=user, purpose=OTPPurpose.signup
    )
    return user, code, emailed


async def resend_verification(db: AsyncSession, email: str) -> tuple[str | None, bool]:
    """Resend OTP. Returns (code_or_None, emailed)."""
    user = await db.scalar(select(User).where(User.email == email.lower().strip()))
    if not user or user.is_verified:
        return None, False
    code, emailed = await otp_service.create_and_send_otp(
        db, user=user, purpose=OTPPurpose.signup
    )
    return code, emailed


async def verify_email_and_issue_tokens(
    db: AsyncSession,
    *,
    email: str,
    code: str,
    request: Request,
    response: Response,
    device_name: str = "Unknown device",
) -> TokenResponse:
    """Validate OTP, mark verified, issue access + refresh tokens."""
    user = await db.scalar(select(User).where(User.email == email.lower().strip()))
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification code")

    if not user.is_verified:
        result = await otp_service.verify_otp(
            db, user_id=user.id, code=code, purpose=OTPPurpose.signup
        )
        if not result.ok:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "otp_invalid",
                    "message": result.error or "Invalid verification code",
                    "attempts_left": result.attempts_left,
                },
            )
        user.is_verified = True
        user.verification_code = None
        user.verification_expires_at = None
        await db.flush()

    return await _issue_session(db, user, request, response, device_name=device_name)


async def verify_account(db: AsyncSession, email: str, code: str) -> User:
    """Legacy verify-only path (no tokens). Prefer verify_email_and_issue_tokens."""
    user = await db.scalar(select(User).where(User.email == email.lower().strip()))
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification code")
    if user.is_verified:
        return user

    result = await otp_service.verify_otp(
        db, user_id=user.id, code=code, purpose=OTPPurpose.signup
    )
    if not result.ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "otp_invalid",
                "message": result.error or "Invalid verification code",
                "attempts_left": result.attempts_left,
            },
        )

    user.is_verified = True
    user.verification_code = None
    user.verification_expires_at = None
    await db.flush()
    return user


async def _issue_session(
    db: AsyncSession,
    user: User,
    request: Request,
    response: Response,
    *,
    device_name: str,
) -> TokenResponse:
    known = await db.scalar(
        select(Device).where(
            Device.user_id == user.id,
            Device.device_name == device_name,
            Device.revoked.is_(False),
        )
    )
    is_new_device = known is None

    access = create_access_token(user.id)
    refresh, jti, expires = create_refresh_token(user.id)
    device = Device(
        user_id=user.id,
        device_name=device_name,
        refresh_jti=jti,
        refresh_token_hash=hash_token(refresh),
        expires_at=expires,
    )
    db.add(device)
    user.last_seen_at = datetime.now(UTC)
    await db.flush()

    if is_new_device:
        ip = request.client.host if request.client else "unknown"
        logger.warning(
            "New login for %s from device=%s ip=%s",
            user.email,
            device_name,
            ip,
        )

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        **settings.refresh_cookie_kwargs(),
    )
    return TokenResponse(access_token=access, expires_in=settings.access_token_minutes * 60)


async def _check_login_rate_limits(request: Request, email: str) -> None:
    ip = request.client.host if request.client else "unknown"
    ip_ok = await rate_limit(
        f"login:ip:{ip}",
        limit=settings.login_max_attempts,
        window_seconds=settings.login_window_seconds,
    )
    acct_ok = await rate_limit(
        f"login:acct:{email.lower()}",
        limit=settings.login_max_attempts,
        window_seconds=settings.login_window_seconds,
    )
    if not ip_ok or not acct_ok:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many login attempts")


async def login(
    db: AsyncSession,
    data: LoginRequest,
    request: Request,
    response: Response,
) -> TokenResponse:
    await _check_login_rate_limits(request, data.email)

    user = await db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_verified:
        code, emailed = await otp_service.create_and_send_otp(
            db, user=user, purpose=OTPPurpose.signup
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "unverified",
                "message": "Account not verified. We sent a new code to your email.",
                "email": user.email,
                "emailed": emailed,
                "verification_code": code if settings.debug else None,
            },
        )

    if user.totp_secret:
        if not data.totp_code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="2FA code required")
        if not pyotp.TOTP(user.totp_secret).verify(data.totp_code, valid_window=1):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid 2FA code")

    return await _issue_session(
        db, user, request, response, device_name=data.device_name
    )


async def start_totp_setup(user: User) -> TotpEnableResponse:
    if user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA already enabled")
    secret = pyotp.random_base32()
    _pending_totp[user.id] = secret
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=settings.app_name)
    return TotpEnableResponse(secret=secret, provisioning_uri=uri)


async def confirm_totp(db: AsyncSession, user: User, code: str) -> None:
    secret = _pending_totp.get(user.id)
    if not secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start 2FA setup first")
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP code")
    user.totp_secret = secret
    _pending_totp.pop(user.id, None)
    await db.flush()


async def disable_totp(db: AsyncSession, user: User, code: str, password: str) -> None:
    if not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA is not enabled")
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    if not pyotp.TOTP(user.totp_secret).verify(code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid 2FA code")
    user.totp_secret = None
    await db.flush()


async def refresh_tokens(db: AsyncSession, request: Request, response: Response) -> TokenResponse:
    refresh = request.cookies.get(REFRESH_COOKIE)
    if not refresh:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    try:
        payload = decode_token(refresh, expected_type="refresh")
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc

    jti = payload["jti"]
    user_id = payload["sub"]
    device = await db.scalar(select(Device).where(Device.refresh_jti == jti, Device.revoked.is_(False)))
    if not device or not verify_token_hash(refresh, device.refresh_token_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token revoked")

    # Rotate
    device.revoked = True
    access = create_access_token(user_id)
    new_refresh, new_jti, expires = create_refresh_token(user_id)
    new_device = Device(
        user_id=user_id,
        device_name=device.device_name,
        refresh_jti=new_jti,
        refresh_token_hash=hash_token(new_refresh),
        expires_at=expires,
    )
    db.add(new_device)
    await db.flush()

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=new_refresh,
        **settings.refresh_cookie_kwargs(),
    )
    return TokenResponse(access_token=access, expires_in=settings.access_token_minutes * 60)


async def logout(db: AsyncSession, request: Request, response: Response, user: User) -> None:
    refresh = request.cookies.get(REFRESH_COOKIE)
    if refresh:
        try:
            payload = decode_token(refresh, expected_type="refresh")
            device = await db.scalar(select(Device).where(Device.refresh_jti == payload["jti"]))
            if device and device.user_id == user.id:
                device.revoked = True
                await db.delete(device)
        except Exception:
            pass
    response.delete_cookie(REFRESH_COOKIE, path="/auth")


async def logout_all(db: AsyncSession, response: Response, user: User) -> None:
    await db.execute(update(Device).where(Device.user_id == user.id).values(revoked=True))
    response.delete_cookie(REFRESH_COOKIE, path="/auth")


async def forgot_password(db: AsyncSession, email: str) -> str | None:
    user = await db.scalar(select(User).where(User.email == email.lower()))
    if not user:
        return None
    token = secrets.token_urlsafe(32)
    user.reset_token = token
    user.reset_token_expires_at = datetime.now(UTC) + timedelta(minutes=15)
    await db.flush()
    return token


async def reset_password(db: AsyncSession, token: str, new_password: str) -> None:
    user = await db.scalar(select(User).where(User.reset_token == token))
    expires = user.reset_token_expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if not user or not expires or expires < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")
    user.password_hash = hash_password(new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    await db.execute(update(Device).where(Device.user_id == user.id).values(revoked=True))
    await db.flush()


def to_user_out(user: User) -> UserOut:
    return UserOut.model_validate(user)
