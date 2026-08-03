from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError, PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.security import decode_token
from backend.models.chat import Chat, ChatMember, MemberRole
from backend.models.message import Message
from backend.models.status import StatusPost
from backend.models.user import User
from backend.services import chat_service, friend_service, status_service

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login/form")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(token, expected_type="access")
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except (InvalidTokenError, PyJWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from None

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def require_status_visible(
    status_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StatusPost:
    post = await db.get(StatusPost, status_id)
    if not post or post.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Status not found")
    if not await status_service.can_view_status(db, post, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this status")
    return post


async def require_chat_member(
    chat_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatMember:
    try:
        return await chat_service.require_member(db, chat_id, user.id)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this chat") from None


async def require_chat_admin(
    chat_id: str,
    member: ChatMember = Depends(require_chat_member),
) -> ChatMember:
    if member.role not in {MemberRole.admin, MemberRole.owner}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return member


async def require_chat_owner(
    chat_id: str,
    member: ChatMember = Depends(require_chat_member),
) -> ChatMember:
    if member.role != MemberRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role required")
    return member


async def require_message_access(
    message_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Message:
    message = await db.get(Message, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    try:
        await chat_service.require_member(db, message.chat_id, user.id)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this chat") from None
    return message


async def get_chat_or_404(chat_id: str, db: AsyncSession = Depends(get_db)) -> Chat:
    chat = await db.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return chat
