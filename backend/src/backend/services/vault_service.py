from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import get_settings
from backend.models.user import User, new_uuid, utcnow
from backend.models.vault import FileTransfer, TransferStatus

settings = get_settings()
VAULT_DIR = Path("vault_storage")


async def create_transfer(
    db: AsyncSession,
    *,
    sender: User,
    filename: str,
    size_bytes: int,
    mime_type: str = "application/octet-stream",
    checksum_sha256: str | None = None,
    receiver_id: str | None = None,
    chat_id: str | None = None,
    download_limit: int | None = None,
    expires_hours: int = 72,
) -> FileTransfer:
    if size_bytes > settings.vault_max_bytes:
        raise ValueError("File exceeds Vault size limit")
    chunk_size = settings.vault_chunk_size
    total_chunks = max(1, math.ceil(size_bytes / chunk_size))
    transfer_id = new_uuid()
    storage_prefix = f"vault/{sender.id}/{transfer_id}"
    (VAULT_DIR / storage_prefix).mkdir(parents=True, exist_ok=True)

    transfer = FileTransfer(
        id=transfer_id,
        sender_id=sender.id,
        receiver_id=receiver_id,
        chat_id=chat_id,
        filename=filename,
        mime_type=mime_type,
        size_bytes=size_bytes,
        checksum_sha256=checksum_sha256,
        chunk_size=chunk_size,
        total_chunks=total_chunks,
        storage_prefix=storage_prefix,
        status=TransferStatus.pending,
        download_limit=download_limit,
        expires_at=datetime.now(UTC) + timedelta(hours=expires_hours),
    )
    db.add(transfer)
    await db.flush()
    return transfer


async def upload_chunk(
    db: AsyncSession,
    transfer: FileTransfer,
    *,
    chunk_index: int,
    data: bytes,
) -> FileTransfer:
    if chunk_index < 0 or chunk_index >= transfer.total_chunks:
        raise ValueError("Invalid chunk index")
    if transfer.status == TransferStatus.complete:
        return transfer
    transfer.status = TransferStatus.uploading
    path = VAULT_DIR / transfer.storage_prefix / f"chunk_{chunk_index:06d}"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(data)
        transfer.uploaded_chunks = min(transfer.total_chunks, transfer.uploaded_chunks + 1)
    if transfer.uploaded_chunks >= transfer.total_chunks:
        transfer.status = TransferStatus.complete
        transfer.completed_at = utcnow()
        # Assemble final file
        final = VAULT_DIR / transfer.storage_prefix / "complete.bin"
        with final.open("wb") as out:
            for i in range(transfer.total_chunks):
                out.write((VAULT_DIR / transfer.storage_prefix / f"chunk_{i:06d}").read_bytes())
    await db.flush()
    return transfer


def transfer_to_dict(t: FileTransfer) -> dict:
    return {
        "id": t.id,
        "filename": t.filename,
        "mimeType": t.mime_type,
        "sizeBytes": t.size_bytes,
        "checksumSha256": t.checksum_sha256,
        "chunkSize": t.chunk_size,
        "totalChunks": t.total_chunks,
        "uploadedChunks": t.uploaded_chunks,
        "status": t.status.value,
        "downloadLimit": t.download_limit,
        "downloadCount": t.download_count,
        "expiresAt": t.expires_at.isoformat() if t.expires_at else None,
        "chatId": t.chat_id,
        "receiverId": t.receiver_id,
        "senderId": t.sender_id,
    }


async def authorize_download(db: AsyncSession, transfer: FileTransfer, user: User) -> Path:
    if transfer.status != TransferStatus.complete:
        raise PermissionError("Transfer not complete")
    if transfer.expires_at:
        exp = transfer.expires_at if transfer.expires_at.tzinfo else transfer.expires_at.replace(tzinfo=UTC)
        if exp < datetime.now(UTC):
            transfer.status = TransferStatus.expired
            await db.flush()
            raise PermissionError("Transfer expired")
    allowed = {transfer.sender_id}
    if transfer.receiver_id:
        allowed.add(transfer.receiver_id)
    if user.id not in allowed and not transfer.chat_id:
        raise PermissionError("Not allowed to download")
    if transfer.chat_id:
        from backend.services import chat_service

        try:
            await chat_service.require_member(db, transfer.chat_id, user.id)
        except PermissionError:
            if user.id not in allowed:
                raise
    if transfer.download_limit is not None and transfer.download_count >= transfer.download_limit:
        raise PermissionError("Download limit reached")
    transfer.download_count += 1
    await db.flush()
    return VAULT_DIR / transfer.storage_prefix / "complete.bin"
