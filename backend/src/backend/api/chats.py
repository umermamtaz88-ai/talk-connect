from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_chat_or_404, get_current_user, require_chat_admin, require_chat_member, require_chat_owner
from backend.models.chat import Chat, ChatMember
from backend.models.user import User
from backend.schemas.auth import MessageResponse
from backend.schemas.chat import AddMembersRequest, ChatOut, ChatUpdate, DirectChatCreate, GroupCreate
from backend.services import chat_service

router = APIRouter(prefix="/chats", tags=["chats"])


async def _chat_out(db, chat: Chat, member: ChatMember | None, viewer_id: str) -> ChatOut:
    data = await chat_service.enrich_chat(db, chat, member, viewer_id)
    return ChatOut.model_validate(data)


@router.get("", response_model=list[ChatOut])
async def list_chats(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await chat_service.list_chats(db, user.id)
    return [await _chat_out(db, c, m, user.id) for c, m in rows]


@router.post("/direct", response_model=ChatOut)
async def create_direct(
    data: DirectChatCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        chat = await chat_service.create_direct_chat(db, user, data.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    member = await chat_service.get_member(db, chat.id, user.id)
    return await _chat_out(db, chat, member, user.id)


@router.post("/groups", response_model=ChatOut)
async def create_group(
    data: GroupCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        chat = await chat_service.create_group(
            db,
            user,
            data.name,
            data.member_user_ids,
            description=data.description,
            is_community=data.is_community,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from None
    member = await chat_service.get_member(db, chat.id, user.id)
    return await _chat_out(db, chat, member, user.id)


@router.get("/notes-to-self", response_model=ChatOut)
async def notes_to_self(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat = await chat_service.get_or_create_notes(db, user)
    member = await chat_service.get_member(db, chat.id, user.id)
    return await _chat_out(db, chat, member, user.id)


@router.get("/{chat_id}", response_model=ChatOut)
async def get_chat(
    chat: Chat = Depends(get_chat_or_404),
    member: ChatMember = Depends(require_chat_member),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _chat_out(db, chat, member, user.id)


@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(
    data: ChatUpdate,
    chat: Chat = Depends(get_chat_or_404),
    member: ChatMember = Depends(require_chat_member),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    needs_admin = any(v is not None for v in (data.name, data.avatar_url))
    if chat.is_group and needs_admin and member.role.value == "member":
        raise HTTPException(status_code=403, detail="Admin role required")
    chat = await chat_service.update_chat(
        db,
        chat,
        name=data.name,
        avatar_url=data.avatar_url,
        theme=data.theme,
        wallpaper=data.wallpaper,
        disappear_after_seconds=data.disappear_after_seconds,
        expires_in_hours=data.expires_in_hours,
        e2e_enabled=data.e2e_enabled,
    )
    # Per-member preference (not a chat-wide admin setting)
    if "auto_translate_language" in data.model_fields_set:
        lang = data.auto_translate_language
        member.auto_translate_language = (lang.strip().lower()[:16] if lang else None)
        await db.flush()
    return await _chat_out(db, chat, member, user.id)


@router.post("/{chat_id}/members", response_model=MessageResponse)
async def add_members(
    data: AddMembersRequest,
    chat: Chat = Depends(get_chat_or_404),
    _: ChatMember = Depends(require_chat_admin),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await chat_service.add_members(db, chat, user.id, data.user_ids)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from None
    return MessageResponse(message="Members added")


@router.delete("/{chat_id}/members/{user_id}", response_model=MessageResponse)
async def remove_member(
    user_id: str,
    chat: Chat = Depends(get_chat_or_404),
    member: ChatMember = Depends(require_chat_member),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user_id != user.id and member.role.value not in {"admin", "owner"}:
        raise HTTPException(status_code=403, detail="Admin role required")
    await chat_service.remove_member(db, chat, user_id)
    return MessageResponse(message="Member removed")


@router.post("/{chat_id}/members/{user_id}/promote", response_model=MessageResponse)
async def promote(
    user_id: str,
    chat_id: str,
    _: ChatMember = Depends(require_chat_owner),
    db: AsyncSession = Depends(get_db),
):
    try:
        await chat_service.promote(db, chat_id, user_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Member not found") from None
    return MessageResponse(message="Promoted")


@router.post("/{chat_id}/members/{user_id}/demote", response_model=MessageResponse)
async def demote(
    user_id: str,
    chat_id: str,
    _: ChatMember = Depends(require_chat_owner),
    db: AsyncSession = Depends(get_db),
):
    try:
        await chat_service.demote(db, chat_id, user_id)
    except (LookupError, PermissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return MessageResponse(message="Demoted")


@router.post("/{chat_id}/leave", response_model=MessageResponse)
async def leave(
    chat: Chat = Depends(get_chat_or_404),
    user: User = Depends(get_current_user),
    _: ChatMember = Depends(require_chat_member),
    db: AsyncSession = Depends(get_db),
):
    await chat_service.leave_group(db, chat, user.id)
    return MessageResponse(message="Left chat")
