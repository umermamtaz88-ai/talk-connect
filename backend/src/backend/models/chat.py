import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.core.database import Base
from backend.models.user import new_uuid, utcnow


class MemberRole(str, enum.Enum):
    member = "member"
    admin = "admin"
    owner = "owner"


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    is_group: Mapped[bool] = mapped_column(Boolean, default=False)
    is_community: Mapped[bool] = mapped_column(Boolean, default=False)
    is_notes_to_self: Mapped[bool] = mapped_column(Boolean, default=False)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    avatar_icon_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    theme: Mapped[str | None] = mapped_column(String(64), nullable=True)
    wallpaper: Mapped[str | None] = mapped_column(String(128), nullable=True)
    disappear_after_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    e2e_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    members = relationship("ChatMember", back_populates="chat", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")


class ChatMember(Base):
    __tablename__ = "chat_members"
    __table_args__ = (UniqueConstraint("chat_id", "user_id", name="uq_chat_member"),)

    chat_id: Mapped[str] = mapped_column(String(36), ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[MemberRole] = mapped_column(Enum(MemberRole), default=MemberRole.member)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    muted: Mapped[bool] = mapped_column(Boolean, default=False)
    notifications_level: Mapped[str] = mapped_column(String(32), default="all")
    custom_tag: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-member auto-translate target language (e.g. "es", "fr"); null = off
    auto_translate_language: Mapped[str | None] = mapped_column(String(16), nullable=True)

    chat = relationship("Chat", back_populates="members")
