"""Local media uploads for status photos/videos (and future chat media)."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from backend.core.config import get_settings
from backend.models.user import new_uuid

settings = get_settings()
MEDIA_DIR = Path("media_storage")

ALLOWED_IMAGE = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_VIDEO = {"video/mp4", "video/webm", "video/quicktime"}
ALLOWED_AUDIO = {
    "audio/webm",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/mp3",
}
ALLOWED = ALLOWED_IMAGE | ALLOWED_VIDEO | ALLOWED_AUDIO

MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_VIDEO_BYTES = 80 * 1024 * 1024
MAX_AUDIO_BYTES = 15 * 1024 * 1024


def _safe_ext(filename: str | None, mime: str) -> str:
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
        if ext.isalnum() and len(ext) <= 8:
            return ext
    guessed = mimetypes.guess_extension(mime) or ""
    return guessed.lstrip(".") or "bin"


async def save_upload(
    *,
    user_id: str,
    data: bytes,
    filename: str | None,
    mime_type: str,
    purpose: str = "status",
) -> dict:
    mime = (mime_type or "application/octet-stream").split(";")[0].strip().lower()
    if mime not in ALLOWED:
        raise ValueError(
            "Only image, video, or audio (webm/ogg/mp3/wav/mp4) uploads are allowed"
        )

    if mime in ALLOWED_AUDIO:
        max_bytes = MAX_AUDIO_BYTES
    elif mime in ALLOWED_VIDEO:
        max_bytes = MAX_VIDEO_BYTES
    else:
        max_bytes = MAX_IMAGE_BYTES
    if len(data) > max_bytes:
        raise ValueError("File too large")
    if not data:
        raise ValueError("Empty file")

    purpose = "".join(ch for ch in purpose if ch.isalnum() or ch in "-_")[:32] or "status"
    ext = _safe_ext(filename, mime)
    file_id = new_uuid()
    storage_key = f"{purpose}/{user_id}/{file_id}.{ext}"
    path = MEDIA_DIR / storage_key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

    if mime in ALLOWED_AUDIO:
        kind = "audio"
    elif mime in ALLOWED_VIDEO:
        kind = "video"
    else:
        kind = "image"
    return {
        "storage_key": storage_key,
        "url": f"/media/{storage_key}",
        "mime_type": mime,
        "size_bytes": len(data),
        "kind": kind,
        "filename": filename,
    }


def resolve_path(storage_key: str) -> Path | None:
    # Prevent path traversal
    key = storage_key.replace("\\", "/").lstrip("/")
    if ".." in key.split("/"):
        return None
    path = (MEDIA_DIR / key).resolve()
    root = MEDIA_DIR.resolve()
    if not str(path).startswith(str(root)):
        return None
    if not path.is_file():
        return None
    return path
