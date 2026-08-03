import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base
from backend.models.user import new_uuid, utcnow


class TransferStatus(str, enum.Enum):
    pending = "pending"
    uploading = "uploading"
    complete = "complete"
    failed = "failed"
    expired = "expired"


class FileTransfer(Base):
    """Vault: chunked, resumable large-file transfer."""

    __tablename__ = "file_transfers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    sender_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    receiver_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    chat_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("chats.id"), nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    chunk_size: Mapped[int] = mapped_column(Integer, default=5 * 1024 * 1024)
    total_chunks: Mapped[int] = mapped_column(Integer)
    uploaded_chunks: Mapped[int] = mapped_column(Integer, default=0)
    storage_prefix: Mapped[str] = mapped_column(String(512))
    status: Mapped[TransferStatus] = mapped_column(Enum(TransferStatus), default=TransferStatus.pending)
    download_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class AvatarIcon(Base):
    __tablename__ = "avatar_icons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    style: Mapped[str] = mapped_column(String(64))
    config: Mapped[str] = mapped_column(Text)  # JSON string for SQLite simplicity
    preview_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    label: Mapped[str] = mapped_column(String(64))
