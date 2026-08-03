from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_chat_or_404, get_current_user, require_chat_member, require_message_access
from backend.models.chat import Chat, ChatMember
from backend.models.message import Message
from backend.models.user import User
from backend.schemas.auth import MessageResponse
from backend.schemas.chat import ForwardRequest, MessageCreate, MessageEdit, MessageReact
from backend.services import chat_service, message_service

router = APIRouter(tags=["messages"])


@router.get("/chats/{chat_id}/messages")
async def list_messages(
    chat_id: str,
    before: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    _: ChatMember = Depends(require_chat_member),
    db: AsyncSession = Depends(get_db),
):
    return await message_service.list_messages(db, chat_id, user.id, limit=limit, before=before)


@router.post("/chats/{chat_id}/messages")
async def send_message(
    data: MessageCreate,
    chat: Chat = Depends(get_chat_or_404),
    user: User = Depends(get_current_user),
    _: ChatMember = Depends(require_chat_member),
    db: AsyncSession = Depends(get_db),
):
    if data.type == "code" and not data.code_language:
        data.code_language = "plaintext"
    try:
        msg = await message_service.send_message(
            db,
            chat=chat,
            sender=user,
            body=data.body,
            msg_type=data.type,
            reply_to_id=data.reply_to_id,
            code_language=data.code_language,
            transcript=data.transcript,
            view_once=data.view_once,
            context=data.context,
            attachments=[
                {
                    "storage_key": a.storage_key,
                    "mime_type": a.mime_type,
                    "size_bytes": a.size_bytes,
                    "filename": a.filename,
                }
                for a in data.attachments
            ],
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from None
    return message_service._message_dict(msg)


@router.get("/chats/{chat_id}/messages/search")
async def search_messages(
    chat_id: str,
    q: str = Query(min_length=1),
    _: ChatMember = Depends(require_chat_member),
    db: AsyncSession = Depends(get_db),
):
    return await message_service.search_messages(db, chat_id, q)


@router.patch("/messages/{message_id}")
async def edit_message(
    data: MessageEdit,
    msg: Message = Depends(require_message_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        updated = await message_service.edit_message(db, msg, user.id, data.body)
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return message_service._message_dict(updated)


@router.delete("/messages/{message_id}", response_model=MessageResponse)
async def delete_message(
    msg: Message = Depends(require_message_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await message_service.delete_message(db, msg, user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    return MessageResponse(message="Deleted")


@router.post("/messages/{message_id}/forward")
async def forward(
    data: ForwardRequest,
    msg: Message = Depends(require_message_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(Chat, data.target_chat_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target chat not found")
    try:
        await chat_service.require_member(db, target.id, user.id)
        forwarded = await message_service.forward_message(db, msg, user, target)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from None
    return message_service._message_dict(forwarded)


@router.post("/messages/{message_id}/read", response_model=MessageResponse)
async def mark_read(
    msg: Message = Depends(require_message_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await message_service.mark_read(db, msg.id, user)
    return MessageResponse(message="Read")


@router.post("/messages/{message_id}/react")
async def react(
    data: MessageReact,
    msg: Message = Depends(require_message_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    reaction = await message_service.react(db, msg, user.id, data.emoji)
    return {"userId": reaction.user_id, "emoji": reaction.emoji, "messageId": msg.id}


@router.delete("/messages/{message_id}/react", response_model=MessageResponse)
async def unreact(
    msg: Message = Depends(require_message_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await message_service.unreact(db, msg, user.id)
    return MessageResponse(message="Reaction removed")


class TranslateRequest(BaseModel):
    target_language: str = Field(min_length=2, max_length=16, alias="targetLanguage")

    model_config = {"populate_by_name": True}


@router.post("/messages/{message_id}/translate")
async def translate_message(
    data: TranslateRequest,
    msg: Message = Depends(require_message_access),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from backend.services import translate_service

    try:
        row = await translate_service.translate_message(
            db, message=msg, target_language=data.target_language
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    return {
        "messageId": msg.id,
        "targetLanguage": row.target_language,
        "sourceLanguage": row.source_language,
        "translatedText": row.translated_text,
        "cached": True,
    }
