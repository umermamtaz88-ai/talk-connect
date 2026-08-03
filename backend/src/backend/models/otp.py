import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base
from backend.models.user import new_uuid, utcnow


class OTPPurpose(str, enum.Enum):
    signup = "signup"
    password_reset = "password_reset"
    login_2fa = "login_2fa"


class EmailOTP(Base):
    __tablename__ = "email_otps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    purpose: Mapped[OTPPurpose] = mapped_column(
        Enum(OTPPurpose, values_callable=lambda obj: [e.value for e in obj], native_enum=False),
        default=OTPPurpose.signup,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReportReason(str, enum.Enum):
    spam = "spam"
    harassment = "harassment"
    inappropriate_content = "inappropriate_content"
    impersonation = "impersonation"
    other = "other"


class ReportStatus(str, enum.Enum):
    pending = "pending"
    reviewed = "reviewed"
    action_taken = "action_taken"
    dismissed = "dismissed"


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    reporter_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reported_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reason: Mapped[ReportReason] = mapped_column(
        Enum(ReportReason, values_callable=lambda obj: [e.value for e in obj], native_enum=False),
    )
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ReportStatus] = mapped_column(
        Enum(ReportStatus, values_callable=lambda obj: [e.value for e in obj], native_enum=False),
        default=ReportStatus.pending,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
