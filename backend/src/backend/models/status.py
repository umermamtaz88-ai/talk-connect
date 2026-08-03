import enum
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.core.database import Base
from backend.models.user import new_uuid, utcnow


class StatusType(str, enum.Enum):
    image = "image"
    video = "video"
    text = "text"


class StatusPrivacy(str, enum.Enum):
    friends = "friends"
    close_friends = "close_friends"
    only_share_with = "only_share_with"
    except_ = "except"


class StatusPost(Base):
    __tablename__ = "status_posts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[StatusType] = mapped_column(Enum(StatusType))
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    background_style: Mapped[str | None] = mapped_column(String(64), nullable=True)
    privacy: Mapped[StatusPrivacy] = mapped_column(
        Enum(StatusPrivacy, values_callable=lambda obj: [e.value for e in obj]),
        default=StatusPrivacy.friends,
    )
    audience_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    is_highlighted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="status_posts")
    views = relationship("StatusView", back_populates="status", cascade="all, delete-orphan")
    replies = relationship("StatusReply", back_populates="status", cascade="all, delete-orphan")


class StatusView(Base):
    __tablename__ = "status_views"
    __table_args__ = (UniqueConstraint("status_id", "viewer_id", name="uq_status_view"),)

    status_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("status_posts.id", ondelete="CASCADE"), primary_key=True
    )
    viewer_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    status = relationship("StatusPost", back_populates="views")


class StatusReply(Base):
    __tablename__ = "status_replies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    status_id: Mapped[str] = mapped_column(String(36), ForeignKey("status_posts.id", ondelete="CASCADE"), index=True)
    from_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    status = relationship("StatusPost", back_populates="replies")
