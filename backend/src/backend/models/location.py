import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base
from backend.models.user import new_uuid, utcnow


class LocationMode(str, enum.Enum):
    static = "static"
    live = "live"


class LocationStatus(str, enum.Enum):
    active = "active"
    stopped = "stopped"
    expired = "expired"


class LocationShare(Base):
    __tablename__ = "location_shares"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("messages.id", ondelete="CASCADE"), unique=True, index=True
    )
    chat_id: Mapped[str] = mapped_column(String(36), ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mode: Mapped[LocationMode] = mapped_column(
        Enum(LocationMode, values_callable=lambda obj: [e.value for e in obj], native_enum=False),
        default=LocationMode.static,
    )
    status: Mapped[LocationStatus] = mapped_column(
        Enum(LocationStatus, values_callable=lambda obj: [e.value for e in obj], native_enum=False),
        default=LocationStatus.active,
    )
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_early: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
