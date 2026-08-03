import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base
from backend.models.user import new_uuid, utcnow


class ReactionTargetType(str, enum.Enum):
    message = "message"
    status = "status"


class Reaction(Base):
    __tablename__ = "reactions"
    __table_args__ = (
        UniqueConstraint("target_type", "target_id", "user_id", name="uq_reaction_target_user"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    target_type: Mapped[ReactionTargetType] = mapped_column(Enum(ReactionTargetType))
    target_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    emoji: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
