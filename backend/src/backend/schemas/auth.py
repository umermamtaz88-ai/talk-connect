from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)
    phone: str | None = None

    @field_validator("email", "username", mode="before")
    @classmethod
    def strip_text(cls, v):
        return v.strip() if isinstance(v, str) else v


class VerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=1, max_length=32)

    @field_validator("email", mode="before")
    @classmethod
    def strip_email(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("code", mode="before")
    @classmethod
    def digits_only(cls, v):
        if isinstance(v, (int, float)):
            v = str(int(v))
        if isinstance(v, str):
            return "".join(ch for ch in v.strip() if ch.isdigit())
        return v

    @field_validator("code")
    @classmethod
    def six_digits(cls, v: str):
        if len(v) != 6:
            raise ValueError("Code must be 6 digits")
        return v

    def normalized_code(self) -> str:
        return self.code


class VerifyEmailRequest(VerifyRequest):
    """Same as VerifyRequest, plus optional device name for session issuance."""

    device_name: str = Field(default="Unknown device", alias="deviceName")

    model_config = {"populate_by_name": True}


class ResendVerifyRequest(BaseModel):
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def strip_email(cls, v):
        return v.strip() if isinstance(v, str) else v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    device_name: str = "Unknown device"
    totp_code: str | None = None

    @field_validator("email", mode="before")
    @classmethod
    def strip_email(cls, v):
        return v.strip() if isinstance(v, str) else v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: str
    username: str
    email: EmailStr
    phone: str | None = None
    display_name: str
    bio: str | None = None
    avatar_url: str | None = None
    avatar_video_url: str | None = None
    cover_photo_url: str | None = None
    is_verified: bool
    last_seen_at: datetime | None = None
    last_seen_visibility: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    message: str


class TotpEnableResponse(BaseModel):
    secret: str
    provisioning_uri: str
    message: str = "Confirm with a TOTP code to enable 2FA"


class TotpConfirmRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class TotpDisableRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)
    password: str
