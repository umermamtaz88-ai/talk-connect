from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import get_settings
from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.core.redis_client import rate_limit
from backend.models.user import User
from backend.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResendVerifyRequest,
    ResetPasswordRequest,
    TokenResponse,
    TotpConfirmRequest,
    TotpDisableRequest,
    TotpEnableResponse,
    UserOut,
    VerifyEmailRequest,
    VerifyRequest,
)
from backend.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/register", response_model=dict)
async def register(
    data: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = request.client.host if request.client else "unknown"
    allowed = await rate_limit(f"register:ip:{ip}", limit=10, window_seconds=3600)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts from this network",
        )

    user, code, emailed = await auth_service.register(db, data)
    payload: dict = {
        "message": (
            "Check your email for a verification code."
            if emailed
            else "Registered. Enter the verification code to continue."
        ),
        "user_id": user.id,
        "email": user.email,
        "emailed": emailed,
    }
    if settings.debug or not emailed:
        payload["verification_code"] = code
    return payload


@router.post("/verify-email", response_model=TokenResponse)
async def verify_email(
    data: VerifyEmailRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Validate OTP and issue session tokens — preferred signup completion path."""
    return await auth_service.verify_email_and_issue_tokens(
        db,
        email=str(data.email),
        code=data.normalized_code(),
        request=request,
        response=response,
        device_name=data.device_name,
    )


@router.post("/verify", response_model=MessageResponse)
async def verify(data: VerifyRequest, db: AsyncSession = Depends(get_db)):
    """Legacy verify-only (no tokens). Prefer /auth/verify-email."""
    await auth_service.verify_account(db, str(data.email), data.normalized_code())
    return MessageResponse(message="Account verified")


@router.post("/resend-otp", response_model=dict)
@router.post("/resend-verification", response_model=dict)
async def resend_otp(data: ResendVerifyRequest, db: AsyncSession = Depends(get_db)):
    email = str(data.email).lower().strip()
    allowed = await rate_limit(f"otp:resend:{email}", limit=3, window_seconds=900)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many resend requests. Try again in a few minutes.",
        )

    code, emailed = await auth_service.resend_verification(db, email)
    payload: dict = {
        "message": "If that account needs verification, a new code was sent.",
        "emailed": emailed,
    }
    if code and (settings.debug or not emailed):
        payload["verification_code"] = code
    return payload


@router.post("/login", response_model=TokenResponse)
async def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.login(db, data, request, response)


@router.post("/login/form", response_model=TokenResponse, include_in_schema=False)
async def login_form(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.login(
        db,
        LoginRequest(email=form.username, password=form.password),
        request,
        response,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    return await auth_service.refresh_tokens(db, request, response)


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await auth_service.logout(db, request, response, user)
    return MessageResponse(message="Logged out")


@router.post("/logout-all", response_model=MessageResponse)
async def logout_all(
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await auth_service.logout_all(db, response, user)
    return MessageResponse(message="Logged out of all devices")


@router.post("/forgot-password", response_model=dict)
async def forgot_password(data: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    token = await auth_service.forgot_password(db, data.email)
    payload: dict = {"message": "If that email exists, a reset link was sent"}
    if token:
        payload["reset_token"] = token
    return payload


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(data: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    await auth_service.reset_password(db, data.token, data.new_password)
    return MessageResponse(message="Password reset. Please log in again.")


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return auth_service.to_user_out(user)


@router.post("/2fa/setup", response_model=TotpEnableResponse)
async def setup_2fa(user: User = Depends(get_current_user)):
    return await auth_service.start_totp_setup(user)


@router.post("/2fa/confirm", response_model=MessageResponse)
async def confirm_2fa(
    data: TotpConfirmRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await auth_service.confirm_totp(db, user, data.code)
    return MessageResponse(message="2FA enabled")


@router.post("/2fa/disable", response_model=MessageResponse)
async def disable_2fa(
    data: TotpDisableRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await auth_service.disable_totp(db, user, data.code, data.password)
    return MessageResponse(message="2FA disabled")
