import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.core.database import Base
from backend.models.user import new_uuid, utcnow


class MessageType(str, enum.Enum):
    text = "text"
    image = "image"
    video = "video"
    voice = "voice"
    file = "file"
    code = "code"
    system = "system"
    location = "location"


class DeliveryState(str, enum.Enum):
    sent = "sent"
    delivered = "delivered"
    read = "read"


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    chat_id: Mapped[str] = mapped_column(String(36), ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    type: Mapped[MessageType] = mapped_column(Enum(MessageType), default=MessageType.text)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    reply_to_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("messages.id"), nullable=True)
    forwarded_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    context: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Code Rooms
    code_language: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Voice transcript
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    view_once: Mapped[bool] = mapped_column(Boolean, default=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    chat = relationship("Chat", back_populates="messages")
    attachments = relationship("Attachment", back_populates="message", cascade="all, delete-orphan")
    statuses = relationship("MessageStatus", back_populates="message", cascade="all, delete-orphan")


class MessageStatus(Base):
    __tablename__ = "message_statuses"

    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    state: Mapped[DeliveryState] = mapped_column(Enum(DeliveryState), default=DeliveryState.sent)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    message = relationship("Message", back_populates="statuses")


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(512))
    mime_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    message = relationship("Message", back_populates="attachments")
