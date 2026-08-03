import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.core.database import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_uuid() -> str:
    return str(uuid.uuid4())


class LastSeenVisibility(str, enum.Enum):
    everyone = "everyone"
    friends = "friends"
    nobody = "nobody"


class AvatarType(str, enum.Enum):
    photo = "photo"
    icon = "icon"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    phone_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(120))
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_text: Mapped[str | None] = mapped_column(String(160), nullable=True)
    avatar_type: Mapped[AvatarType] = mapped_column(Enum(AvatarType), default=AvatarType.icon)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    avatar_icon_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    avatar_video_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    cover_photo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_visibility: Mapped[LastSeenVisibility] = mapped_column(
        Enum(LastSeenVisibility), default=LastSeenVisibility.friends
    )
    read_receipts_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    typing_indicators_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Focus Sync — busy until timestamp, soft heads-up for selected contacts
    focus_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    focus_message: Mapped[str | None] = mapped_column(String(200), nullable=True)
    focus_share_with: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list of user ids
    phone_visibility: Mapped[str] = mapped_column(String(32), default="friends")
    findable_by_phone: Mapped[str] = mapped_column(String(32), default="everyone")
    reset_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reset_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    devices = relationship("Device", back_populates="user", cascade="all, delete-orphan")
    status_posts = relationship("StatusPost", back_populates="user", cascade="all, delete-orphan")
