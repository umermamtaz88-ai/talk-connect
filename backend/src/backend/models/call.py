import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base
from backend.models.user import new_uuid, utcnow


class CallType(str, enum.Enum):
    audio = "audio"
    video = "video"


class CallStatus(str, enum.Enum):
    ringing = "ringing"
    active = "active"
    ended = "ended"
    missed = "missed"
    declined = "declined"


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    chat_id: Mapped[str] = mapped_column(String(36), ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    started_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    call_type: Mapped[CallType] = mapped_column(Enum(CallType), default=CallType.video)
    status: Mapped[CallStatus] = mapped_column(Enum(CallStatus), default=CallStatus.ringing)
    livekit_room: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)


class CallParticipant(Base):
    __tablename__ = "call_participants"

    call_id: Mapped[str] = mapped_column(String(36), ForeignKey("calls.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    screen_sharing: Mapped[bool] = mapped_column(Boolean, default=False)
