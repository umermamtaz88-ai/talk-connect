from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from backend.core.deps import get_current_user
from backend.models.user import User
from backend.services import media_service

router = APIRouter(prefix="/media", tags=["media"])


@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    purpose: str = Form(default="status"),
    user: User = Depends(get_current_user),
):
    data = await file.read()
    try:
        result = await media_service.save_upload(
            user_id=user.id,
            data=data,
            filename=file.filename,
            mime_type=file.content_type or "application/octet-stream",
            purpose=purpose,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    return result


@router.get("/{storage_key:path}")
async def get_media(storage_key: str):
    path = media_service.resolve_path(storage_key)
    if not path:
        raise HTTPException(status_code=404, detail="Media not found")
    mime, _ = __import__("mimetypes").guess_type(str(path))
    return FileResponse(path, media_type=mime or "application/octet-stream")
