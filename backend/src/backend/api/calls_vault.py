from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.call import Call
from backend.models.user import User
from backend.models.vault import FileTransfer
from backend.schemas.auth import MessageResponse
from backend.schemas.chat import CallCreate, VaultCreate
from backend.services import call_service, vault_service

router = APIRouter(tags=["calls-vault"])


@router.post("/calls")
async def start_call(
    data: CallCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        call = await call_service.start_call(db, chat_id=data.chat_id, starter=user, call_type=data.call_type)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from None
    return {
        "id": call.id,
        "chatId": call.chat_id,
        "callType": call.call_type.value,
        "status": call.status.value,
        "livekitRoom": call.livekit_room,
    }


@router.post("/calls/{call_id}/join")
async def join_call(
    call_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    call = await db.get(Call, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    try:
        return await call_service.join_call(db, call, user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None


@router.post("/calls/{call_id}/leave", response_model=MessageResponse)
async def leave_call(
    call_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    call = await db.get(Call, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    await call_service.leave_call(db, call, user)
    return MessageResponse(message="Left call")


@router.post("/calls/{call_id}/screen-share", response_model=MessageResponse)
async def screen_share(
    call_id: str,
    sharing: bool = True,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    call = await db.get(Call, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    await call_service.set_screen_share(db, call, user, sharing)
    return MessageResponse(message="Screen share updated")


@router.get("/calls/{call_id}")
async def get_call(call_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    call = await db.get(Call, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return {
        "id": call.id,
        "chatId": call.chat_id,
        "status": call.status.value,
        "callType": call.call_type.value,
        "startedBy": call.started_by,
        "durationSeconds": call.duration_seconds,
    }


@router.get("/calls/history")
async def call_history(
    chat_id: str = Query(alias="chat_id"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from backend.services import chat_service

    try:
        await chat_service.require_member(db, chat_id, user.id)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not a member") from None
    rows = await call_service.history(db, chat_id)
    return [
        {
            "id": c.id,
            "status": c.status.value,
            "callType": c.call_type.value,
            "startedBy": c.started_by,
            "startedAt": c.started_at.isoformat() if c.started_at else None,
            "durationSeconds": c.duration_seconds,
        }
        for c in rows
    ]


@router.post("/vault")
async def create_vault(
    data: VaultCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        transfer = await vault_service.create_transfer(
            db,
            sender=user,
            filename=data.filename,
            size_bytes=data.size_bytes,
            mime_type=data.mime_type,
            checksum_sha256=data.checksum_sha256,
            receiver_id=data.receiver_id,
            chat_id=data.chat_id,
            download_limit=data.download_limit,
            expires_hours=data.expires_hours,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return vault_service.transfer_to_dict(transfer)


@router.put("/vault/{transfer_id}/chunks/{chunk_index}")
async def upload_chunk(
    transfer_id: str,
    chunk_index: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    transfer = await db.get(FileTransfer, transfer_id)
    if not transfer or transfer.sender_id != user.id:
        raise HTTPException(status_code=404, detail="Transfer not found")
    data = await file.read()
    try:
        transfer = await vault_service.upload_chunk(db, transfer, chunk_index=chunk_index, data=data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return vault_service.transfer_to_dict(transfer)


@router.get("/vault/{transfer_id}")
async def get_vault(transfer_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    transfer = await db.get(FileTransfer, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return vault_service.transfer_to_dict(transfer)


@router.get("/vault/{transfer_id}/download")
async def download_vault(
    transfer_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    transfer = await db.get(FileTransfer, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    try:
        path = await vault_service.authorize_download(db, transfer, user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    return FileResponse(path, filename=transfer.filename, media_type=transfer.mime_type)
